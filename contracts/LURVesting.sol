// solhint-disable gas-strict-inequalities, ordering, no-empty-blocks, gas-increment-by-one
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {PausableExtUpgradeable} from "./core/PausableExtUpgradeable.sol";
import {ILURVesting} from "./interfaces/ILURVesting.sol";

/**
 * @title LURVesting
 * @author lumera
 * @notice This contract allows the owner to create vesting pools for beneficiaries and manage their vesting schedules.
 * @dev It uses OpenZeppelin's AccessControl for role-based access management and SafeERC20 for safe token transfers.
 */
contract LURVesting is Initializable, UUPSUpgradeable, ReentrancyGuardUpgradeable, PausableExtUpgradeable, ILURVesting {
    using SafeERC20 for IERC20;

    struct VestingStorage {
        /// @notice Total number of pools created
        uint256 totalPools;
        /// @notice The token that is being vested
        address token;
        /// @notice Amount of tokens reserved in active vestings
        uint256 totalVested;
        /// @notice Pool rules by pool ID
        mapping(uint256 poolId => Pool pool) pools;
        /// @notice User allocation data by user address and pool ID
        mapping(address userAddress => mapping(uint256 poolId => UserAllocation allocation)) userByPool;
    }

    /**
     * @notice The role that allows to withdraw tokens or Ether from the contract.
     */
    bytes32 public constant WITHDRAWER_ROLE = keccak256("WITHDRAWER_ROLE");

    /**
     * @notice The role that allows to create vesting pools and allocate tokens.
     */
    bytes32 public constant MANAGER_ROLE = keccak256("MANAGER_ROLE");

    /**
     * @notice The denominator for basis points calculations (100% = 10000 basis points)
     */
    uint256 public constant BASIS_POINTS_DENOMINATOR = 10000;

    /**
     * @notice The maximum number of allocations that can be processed in a single batch transaction
     */
    uint256 public constant MAX_BATCH_SIZE = 100;

    /**
     * @notice The storage slot used to store the vesting data
     * @dev keccak256(abi.encode(uint256(keccak256("lurvesting.storage.main")) - 1)) & ~bytes32(uint256(0xff))
     */
    bytes32 internal constant _VESTING_STORAGE_SLOT =
        0x663a5a6be7a15f21b21e9826593d6ce55ce8680843d938f4377987c542a45d00;

    /**
     * @notice Constructor is disabled to prevent initialization of the implementation contract
     * @custom:oz-upgrades-unsafe-allow constructor
     */
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initializes the contract by setting up roles and vested token
     * @param token The address of the token to be vested
     * @param dao The address of the DAO contract which will have the DEFAULT_ADMIN_ROLE
     * @param vestingManager The address of the vesting manager who will have the MANAGER_ROLE
     */
    function initialize(address token, address dao, address vestingManager) external initializer {
        require(token != address(0) && dao != address(0) && vestingManager != address(0), LURVesting__ZeroAddress());

        __UUPSUpgradeable_init();
        __ReentrancyGuard_init_unchained();
        __PausableExt_init_unchained();

        VestingStorage storage $ = _vestingStorage();
        $.token = token;

        _grantRole(DEFAULT_ADMIN_ROLE, dao);
        _grantRole(MANAGER_ROLE, dao);
        _grantRole(MANAGER_ROLE, vestingManager);

        _setRoleAdmin(MANAGER_ROLE, DEFAULT_ADMIN_ROLE);
    }

    /**
     * @notice Creates a new vesting pool with the given schedule rules
     * @param p Pool creation parameters
     * @return poolId The ID of the created pool
     */
    function createPool(CreatePoolParams calldata p) external onlyRole(MANAGER_ROLE) returns (uint256 poolId) {
        require(bytes(p.name).length != 0 && bytes(p.name).length <= 64, LURVesting__InvalidName());
        require(p.periodDuration != 0 && p.periodCount != 0, LURVesting__ZeroAmount());
        require(p.initialUnlockPercent <= BASIS_POINTS_DENOMINATOR, LURVesting__InitialUnlockExceedsLimit());

        VestingStorage storage $ = _vestingStorage();
        poolId = $.totalPools++;

        $.pools[poolId] = Pool({
            name: p.name,
            cliffDuration: p.cliffDuration,
            periodDuration: p.periodDuration,
            periodCount: p.periodCount,
            initialUnlockPercent: p.initialUnlockPercent,
            claimPaused: false
        });

        emit PoolCreated(poolId, p.name, p.cliffDuration, p.periodDuration, p.periodCount, p.initialUnlockPercent);
    }

    /**
     * @notice Allocates vesting tokens for a single recipient in a specific pool
     * @param poolId The ID of the vesting pool
     * @param recipient The address of the beneficiary
     * @param amount The total amount of tokens to vest
     * @param start Vesting start timestamp (0 = block.timestamp)
     * @dev Pulls tokens from the caller; reverts if recipient already has an allocation in this pool
     */
    function allocate(
        uint256 poolId,
        address recipient,
        uint256 amount,
        uint256 start
    ) external onlyRole(MANAGER_ROLE) {
        VestingStorage storage $ = _vestingStorage();
        require(poolId < $.totalPools, LURVesting__PoolNotExists());

        _allocate($, poolId, recipient, amount, start);
        IERC20($.token).safeTransferFrom(_msgSender(), address(this), amount);
    }

    /**
     * @notice Allocates vesting tokens for multiple recipients in a single transaction
     * @param poolId The ID of the vesting pool
     * @param entries Array of allocation params (recipient, amount, start)
     * @dev Pulls the total tokens from the caller in one transfer; reverts if batch is empty or exceeds MAX_BATCH_SIZE
     */
    function allocateBatch(uint256 poolId, AllocateParams[] calldata entries) external onlyRole(MANAGER_ROLE) {
        uint256 len = entries.length;
        require(len != 0 && len <= MAX_BATCH_SIZE, LURVesting__InvalidBatchSize());

        VestingStorage storage $ = _vestingStorage();
        require(poolId < $.totalPools, LURVesting__PoolNotExists());

        uint256 totalAmount;
        for (uint256 i; i < len; ++i) {
            totalAmount += entries[i].amount;
        }

        for (uint256 i; i < len; ++i) {
            _allocate($, poolId, entries[i].recipient, entries[i].amount, entries[i].start);
        }

        IERC20($.token).safeTransferFrom(_msgSender(), address(this), totalAmount);
    }

    /**
     * @notice Internal function to allocate vesting tokens for recipient in a specific pool without transferring tokens
     * @param s The vesting storage reference
     * @param poolId The ID of the vesting pool
     * @param recipient The address of the recipient
     * @param amount The amount of tokens to allocate
     * @param start The start timestamp for the vesting
     */
    function _allocate(
        VestingStorage storage s,
        uint256 poolId,
        address recipient,
        uint256 amount,
        uint256 start
    ) internal {
        require(recipient != address(0), LURVesting__ZeroAddress());
        require(amount != 0, LURVesting__ZeroAmount());

        UserAllocation storage allocation = s.userByPool[recipient][poolId];
        require(allocation.total == 0, LURVesting__AlreadyAllocated());

        uint256 vestStart = start == 0 ? block.timestamp : start;

        allocation.total = amount;
        allocation.start = vestStart;
        s.totalVested += amount;

        emit Allocated(poolId, recipient, amount, vestStart);
    }

    /**
     * @notice Claims all available vested tokens for the caller from a specific pool
     * @param poolId The ID of the pool to claim from
     */
    function claim(uint256 poolId) external nonReentrant whenNotPaused {
        VestingStorage storage $ = _vestingStorage();
        require(poolId < $.totalPools, LURVesting__PoolNotExists());

        Pool storage pool = $.pools[poolId];
        require(!pool.claimPaused, LURVesting__ClaimPaused());

        address sender = _msgSender();
        UserAllocation storage allocation = $.userByPool[sender][poolId];
        require(allocation.total != 0, LURVesting__NoAllocationsFound());

        uint256 claimable = _getClaimableAmount(pool, allocation);
        require(claimable != 0, LURVesting__ZeroAmount());

        allocation.claimed += claimable;
        $.totalVested -= claimable;

        IERC20($.token).safeTransfer(sender, claimable);

        emit Claim(sender, poolId, claimable);
    }

    /**
     * @notice Pauses or resumes claiming for a specific pool
     * @param poolId The ID of the pool to update
     * @param paused_ Whether to pause (true) or resume (false) claiming
     */
    function setClaimPaused(uint256 poolId, bool paused_) external onlyRole(PAUSER_ROLE) {
        VestingStorage storage $ = _vestingStorage();
        require(poolId < $.totalPools, LURVesting__PoolNotExists());
        $.pools[poolId].claimPaused = paused_;
    }

    /**
     * @notice Withdraws unused (non-vested) tokens from the contract
     * @param token The address of the token to withdraw
     * @param recipient The address to send the tokens to
     * @param amount The amount to withdraw
     */
    function refund(address token, address recipient, uint256 amount) external onlyRole(WITHDRAWER_ROLE) {
        require(token != address(0) && recipient != address(0), LURVesting__ZeroAddress());

        VestingStorage storage $ = _vestingStorage();
        uint256 balance = IERC20(token).balanceOf(address(this));
        uint256 withdrawable = token == $.token ? (balance > $.totalVested ? balance - $.totalVested : 0) : balance;

        require(withdrawable >= amount, LURVesting__NotEnoughBalance(withdrawable, amount));

        IERC20(token).safeTransfer(recipient, amount);
        emit Refund(token, recipient, amount);
    }

    /**
     * @notice Returns paginated list of pools with user-specific allocation details
     * @param user The address of the user for whom to retrieve allocation details
     * @param offset The starting pool index
     * @param limit The maximum number of pools to return
     * @return An array of UserPoolExtended structs containing pool and allocation details for the user
     */
    function getPools(address user, uint256 offset, uint256 limit) external view returns (UserPoolExtended[] memory) {
        VestingStorage storage $ = _vestingStorage();
        uint256 total = $.totalPools;

        if (offset >= total || limit == 0) {
            return new UserPoolExtended[](0);
        }

        uint256 actualLimit = offset + limit > total ? total - offset : limit;
        UserPoolExtended[] memory result = new UserPoolExtended[](actualLimit);

        for (uint256 i; i < actualLimit; ++i) {
            uint256 id = offset + i;
            Pool storage pool = $.pools[id];
            UserAllocation storage alloc = $.userByPool[user][id];

            result[i] = UserPoolExtended({
                id: id,
                name: pool.name,
                cliffDuration: pool.cliffDuration,
                periodDuration: pool.periodDuration,
                periodCount: pool.periodCount,
                initialUnlockPercent: pool.initialUnlockPercent,
                claimPaused: pool.claimPaused,
                allocatedForUser: alloc.total,
                claimedByUser: alloc.claimed,
                startForUser: alloc.start,
                claimableForUser: alloc.total > 0 ? _getClaimableAmount(pool, alloc) : 0
            });
        }

        return result;
    }

    /**
     * @notice Returns the pool rules for a given pool ID
     * @param poolId The ID of the pool to retrieve
     * @return The Pool struct containing the rules for the specified pool
     */
    function getPool(uint256 poolId) external view returns (Pool memory) {
        return _vestingStorage().pools[poolId];
    }

    /**
     * @notice Returns the allocation details for a user in a given pool
     * @param user The address of the user
     * @param poolId The ID of the pool to retrieve
     * @return The UserAllocation struct containing the allocation details for the specified user and pool
     */
    function getUserAllocation(address user, uint256 poolId) external view returns (UserAllocation memory) {
        return _vestingStorage().userByPool[user][poolId];
    }

    /**
     * @notice Returns the claimable amount for a user in a specific pool
     * @param user The address of the user
     * @param poolId The ID of the pool to check
     * @return The amount of tokens that the user can currently claim from the specified pool
     */
    function getClaimableAmount(address user, uint256 poolId) external view returns (uint256) {
        VestingStorage storage $ = _vestingStorage();
        UserAllocation storage alloc = $.userByPool[user][poolId];
        if (alloc.total == 0) return 0;
        return _getClaimableAmount($.pools[poolId], alloc);
    }

    /**
     * @notice Returns the total number of pools created
     * @return The total number of vesting pools that have been created in the contract
     */
    function getTotalPools() external view returns (uint256) {
        return _vestingStorage().totalPools;
    }

    /**
     * @notice Internal function to calculate the claimable amount for a user in a specific pool
     * @param pool The Pool struct containing the vesting rules for the pool
     * @param alloc The UserAllocation struct containing the allocation details for the user
     * @return The amount of tokens that the user can currently claim from the specified pool
     */
    function _getClaimableAmount(Pool storage pool, UserAllocation storage alloc) internal view returns (uint256) {
        uint256 unlocked = _calculateUnlockedAmount(pool, alloc);
        return unlocked > alloc.claimed ? unlocked - alloc.claimed : 0;
    }

    /**
     * @notice Internal function to calculate the total unlocked amount for a user in a specific pool
     * @param pool The Pool struct containing the vesting rules for the pool
     * @param alloc The UserAllocation struct containing the allocation details for the user
     * @return The total amount of tokens that have been unlocked for the user in the specified pool
     */
    function _calculateUnlockedAmount(Pool storage pool, UserAllocation storage alloc) internal view returns (uint256) {
        uint256 cliffEnd = alloc.start + pool.cliffDuration;
        if (block.timestamp < cliffEnd) return 0;

        uint256 total = alloc.total;
        uint256 initialAmount = (total * pool.initialUnlockPercent) / BASIS_POINTS_DENOMINATOR;

        uint256 passedPeriods = (block.timestamp - alloc.start - pool.cliffDuration) / pool.periodDuration;

        return
            passedPeriods >= pool.periodCount
                ? total
                : ((total - initialAmount) * passedPeriods) / pool.periodCount + initialAmount;
    }

    /**
     * @notice Internal function to access the vesting storage
     * @return s The VestingStorage struct containing the vesting state
     */
    function _vestingStorage() internal pure returns (VestingStorage storage s) {
        // solhint-disable-next-line no-inline-assembly
        assembly {
            s.slot := _VESTING_STORAGE_SLOT
        }
    }

    /**
     * @notice Authorizes an upgrade to a new implementation contract
     * @param newImplementation The address of the new implementation contract
     */
    function _authorizeUpgrade(address newImplementation) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}
}
