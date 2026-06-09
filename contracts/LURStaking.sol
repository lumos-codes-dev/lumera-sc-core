// solhint-disable no-empty-blocks, ordering, gas-strict-inequalities, gas-increment-by-one
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {PausableExtUpgradeable} from "./core/PausableExtUpgradeable.sol";
import {ILURStaking} from "./interfaces/ILURStaking.sol";

/**
 * @title LURStaking
 * @author lumera
 * @notice This contract allows users to stake ERC20 tokens in different pools to earn rewards. It supports multiple
 *         pools with configurable parameters and includes features for pausing, unstaking, and refunding.
 * @dev The contract is upgradeable using UUPS pattern and includes reentrancy guards for security.
 */
contract LURStaking is Initializable, UUPSUpgradeable, ReentrancyGuardUpgradeable, PausableExtUpgradeable, ILURStaking {
    using SafeERC20 for IERC20;

    /**
     * @notice Staking storage struct to hold all pools and user stakes data
     */
    struct StakingStorage {
        /// @notice Total number of pools created
        uint256 totalPools;
        /// @notice Mapping to store pools by their ID
        mapping(uint256 poolId => Pool pool) pools;
        /// @notice Mapping to store user stakes by user address and pool ID
        mapping(address userAddress => mapping(uint256 poolId => UserStake userStake)) userStakes;
    }

    /**
     * @notice The role that allows to withdraw tokens or Ether from the contract.
     */
    bytes32 public constant WITHDRAWER_ROLE = keccak256("WITHDRAWER_ROLE");

    /**
     * @notice Constant for basis points denominator used in APR calculations
     * @dev Used to represent percentages in basis points, where 10000 basis points equals 100%
     */
    uint32 public constant BPS = 10_000;

    /**
     * @notice Constant for the number of seconds in a year, used for reward calculations
     */
    uint32 public constant SECONDS_IN_YEAR = 365 days;

    /**
     * @notice The storage slot used to store the staking data
     * @dev keccak256(abi.encode(uint256(keccak256("lurstaking.storage.main")) - 1)) & ~bytes32(uint256(0xff))
     */
    bytes32 internal constant _STAKING_STORAGE_SLOT =
        0x21cad9f6bb77c5b827f0cefa73f501ed6f48a480cd9d1d9f73bdcd463108b700;

    /**
     * @notice The constructor is disabled to prevent initialization of the implementation contract
     * @custom:oz-upgrades-unsafe-allow constructor
     */
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initializes the contract by setting up roles and initial state
     * @param admin The address that will be granted the DEFAULT_ADMIN_ROLE and WITHDRAWER_ROLE
     */
    function initialize(address admin) external initializer {
        require(admin != address(0), LURStaking__ZeroAddress());

        __UUPSUpgradeable_init();
        __ReentrancyGuard_init_unchained();
        __PausableExt_init_unchained();

        _setRoleAdmin(WITHDRAWER_ROLE, DEFAULT_ADMIN_ROLE);
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    /// @notice Creates a new pool (rewards or vote power)
    /// @param params_ Parameters for creating the pool including name, token address,
    ///                APR, lock duration, min and max stake amounts
    /// @return poolId ID of the created pool
    function createPool(
        CreatePoolParams calldata params_
    ) external onlyRole(DEFAULT_ADMIN_ROLE) returns (uint256 poolId) {
        require(bytes(params_.name).length != 0 && bytes(params_.name).length <= 64, LURStaking__InvalidName());
        require(params_.token != address(0), LURStaking__ZeroAddress());
        require(params_.apr != 0 && params_.lockDuration != 0 && params_.maxStakeAmount != 0, LURStaking__ZeroAmount());
        require(params_.minStakeAmount <= params_.maxStakeAmount, LURStaking__InvalidAmounts());

        StakingStorage storage s = _stakingStorage();
        poolId = s.totalPools++;

        s.pools[poolId] = Pool({
            name: params_.name,
            token: IERC20(params_.token),
            apr: params_.apr,
            lockDuration: params_.lockDuration,
            minStakeAmount: params_.minStakeAmount,
            maxStakeAmount: params_.maxStakeAmount,
            stakingPaused: false,
            unstakingPaused: false,
            totalStaked: 0
        });

        emit PoolCreated(poolId, params_.token);
    }

    /**
     * @notice Stakes tokens in a specific pool to earn rewards or vote power
     * @param poolId ID of the pool to stake in
     * @param amount Amount of tokens to stake
     * @dev The function checks that staking is not paused for the pool, the amount is within limits,
     *      and then transfers the tokens from the user to the contract. It also calculates the lock duration
     *      and emits a Staked event with details of the stake.
     */
    function stake(uint256 poolId, uint256 amount) external nonReentrant whenNotPaused {
        StakingStorage storage s = _stakingStorage();
        require(poolId < s.totalPools, LURStaking__PoolNotExists());
        require(amount != 0, LURStaking__ZeroAmount());

        Pool storage pool = s.pools[poolId];
        require(!pool.stakingPaused, LURStaking__StakingPaused());

        address sender = _msgSender();
        UserStake storage userStake = s.userStakes[sender][poolId];

        uint256 stakedBefore = userStake.staked;
        require(stakedBefore + amount >= pool.minStakeAmount, LURStaking__AmountTooLow());
        require(stakedBefore + amount <= pool.maxStakeAmount, LURStaking__AmountTooHigh());

        pool.token.safeTransferFrom(sender, address(this), amount);

        uint256 lockUntil = block.timestamp + pool.lockDuration;

        userStake.staked += amount;
        userStake.lockUntil = lockUntil;
        pool.totalStaked += amount;

        uint256 userStaked = userStake.staked;
        uint256 rewards = _calculateRewards(userStaked, pool);

        emit Staked(sender, poolId, address(pool.token), userStaked, lockUntil, rewards);
    }

    /**
     * @notice Unstakes tokens from a specific pool
     * @param poolId ID of the pool to unstake from
     * @param force Whether to force unstake (bypassing lock period)
     * @notice Force unstake is not allowed for vote power pools
     */
    function unstake(uint256 poolId, bool force) external nonReentrant whenNotPaused {
        StakingStorage storage s = _stakingStorage();
        require(poolId < s.totalPools, LURStaking__PoolNotExists());

        Pool storage pool = s.pools[poolId];
        require(!pool.unstakingPaused, LURStaking__UnstakingPaused());

        address sender = _msgSender();
        UserStake storage userStake = s.userStakes[sender][poolId];
        require(userStake.staked != 0, LURStaking__ZeroAmount());

        _unstakeFor(sender, poolId, force);
    }

    /**
     * @notice Pauses or resumes staking for a specific pool
     * @param poolId ID of the pool to update
     * @param paused_ Whether to pause (true) or resume (false) staking
     */
    function setStakingPaused(uint256 poolId, bool paused_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        StakingStorage storage s = _stakingStorage();
        require(poolId < s.totalPools, LURStaking__PoolNotExists());
        s.pools[poolId].stakingPaused = paused_;
        emit StakingPausedUpdated(poolId, paused_);
    }

    /**
     * @notice Sets unstaking pause status for a pool
     * @param poolId ID of the pool to update
     * @param paused_ Whether unstaking is paused for this pool
     */
    function setUnstakingPaused(uint256 poolId, bool paused_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        StakingStorage storage s = _stakingStorage();
        require(poolId < s.totalPools, LURStaking__PoolNotExists());
        s.pools[poolId].unstakingPaused = paused_;
        emit UnstakingPausedUpdated(poolId, paused_);
    }

    /**
     * @notice Refunds tokens or Ether from the contract to a specified address.
     * @param token The address of the ERC20 token to refund, or zero address for Ether.
     * @param to The address to which the refunded tokens or Ether will be sent.
     * @param amount The amount of tokens or Ether to refund.
     * @dev Only accounts with the WITHDRAWER_ROLE can call this function. The function checks that the refund does not
     *      exceed the withdrawable balance before performing the transfer.
     */
    function refund(address token, address to, uint256 amount) external onlyRole(WITHDRAWER_ROLE) nonReentrant {
        require(to != address(0), LURStaking__ZeroAddress());
        require(amount != 0, LURStaking__ZeroAmount());

        uint256 totalStakedForToken;
        uint256 reservedRewards;
        StakingStorage storage s = _stakingStorage();

        for (uint256 i; i < s.totalPools; ++i) {
            if (address(s.pools[i].token) == address(token)) {
                totalStakedForToken += s.pools[i].totalStaked;
                reservedRewards += _calculateRewards(s.pools[i].totalStaked, s.pools[i]);
            }
        }

        uint256 balance = token == address(0) ? address(this).balance : IERC20(token).balanceOf(address(this));
        uint256 locked = totalStakedForToken + reservedRewards;
        uint256 withdrawable = balance > locked ? balance - locked : 0;
        require(withdrawable >= amount, LURStaking__WithdrawAmountExceedsWithdrawableBalance());

        if (token == address(0)) {
            (bool success, ) = to.call{value: amount}("");
            require(success, LURStaking__TransferFailed());
        } else {
            IERC20(token).safeTransfer(to, amount);
        }

        emit Refund(token, to, amount);
    }

    /**
     * @notice Gets a list of pools with user-specific details for a given user, supporting pagination.
     * @param user The address of the user for whom to retrieve pool details
     * @param offset The starting index for pagination
     * @param limit The maximum number of pools to return
     * @return An array of UserPoolExtended structs containing pool details and user-specific information
     */
    function getPools(address user, uint256 offset, uint256 limit) external view returns (UserPoolExtended[] memory) {
        StakingStorage storage s = _stakingStorage();
        uint256 totalPools = s.totalPools;

        if (offset >= totalPools || limit == 0) {
            return new UserPoolExtended[](0);
        }

        uint256 actualLimit = limit;
        if (offset + limit > totalPools) {
            actualLimit = totalPools - offset;
        }

        bool contractPaused = paused();
        UserPoolExtended[] memory userPools = new UserPoolExtended[](actualLimit);

        for (uint256 i; i < actualLimit; ++i) {
            uint256 poolId = offset + i;
            UserStake memory userStake = s.userStakes[user][poolId];
            Pool memory pool = s.pools[poolId];

            userPools[i] = UserPoolExtended({
                id: poolId,
                name: pool.name,
                token: pool.token,
                apr: pool.apr,
                lockDuration: pool.lockDuration,
                minStakeAmount: pool.minStakeAmount,
                maxStakeAmount: pool.maxStakeAmount,
                stakingPaused: contractPaused || pool.stakingPaused,
                unstakingPaused: contractPaused || pool.unstakingPaused,
                totalStaked: pool.totalStaked,
                stakedByUser: userStake.staked,
                stakedByUserAt: userStake.lockUntil != 0 ? userStake.lockUntil - pool.lockDuration : 0,
                lockedUntilForUser: userStake.lockUntil,
                pendingRewards: userStake.staked > 0 ? _calculateRewards(userStake.staked, pool) : 0,
                isTokensLocked: userStake.lockUntil > block.timestamp
            });
        }

        return userPools;
    }

    /**
     * @notice Gets details of a specific pool by its ID
     * @param poolId_ ID of the pool to retrieve
     * @return Pool struct containing details of the specified pool
     */
    function getPool(uint256 poolId_) external view returns (Pool memory) {
        return _stakingStorage().pools[poolId_];
    }

    /**
     * @notice Gets user stake details for a specific pool
     * @param user Address of the user to check
     * @param poolId ID of the pool to check
     * @return staked Amount of tokens staked by the user
     * @return lockUntil Timestamp until which the user's tokens are locked
     * @return pendingRewards Amount of rewards pending for the user
     * @return isLocked Whether the user's tokens are currently locked
     */
    function getUserStakeDetails(
        address user,
        uint256 poolId
    ) external view returns (uint256 staked, uint256 lockUntil, uint256 pendingRewards, bool isLocked) {
        StakingStorage storage s = _stakingStorage();
        Pool memory pool = s.pools[poolId];
        UserStake memory userStake = s.userStakes[user][poolId];

        staked = userStake.staked;
        lockUntil = userStake.lockUntil;
        pendingRewards = userStake.staked > 0 ? _calculateRewards(userStake.staked, pool) : 0;
        isLocked = block.timestamp < userStake.lockUntil;
    }

    /**
     * @notice Gets the total number of pools created
     * @return totalPools Total number of pools
     */
    function getTotalPools() external view returns (uint256) {
        return _stakingStorage().totalPools;
    }

    /**
     * @notice Internal function to unstake tokens for a user
     * @param user The address of the user to unstake for
     * @param poolId The ID of the pool to unstake from
     * @param force Whether to force unstake (bypassing lock duration for rewards)
     * @dev Force unstake is not allowed for vote power pools
     */
    function _unstakeFor(address user, uint256 poolId, bool force) internal {
        StakingStorage storage s = _stakingStorage();

        Pool storage pool = s.pools[poolId];
        UserStake storage userStake = s.userStakes[user][poolId];

        uint256 stakedAmount = userStake.staked;
        uint256 earnedRewards;

        if (!force) {
            require(block.timestamp >= userStake.lockUntil, LURStaking__TokensLocked());
            earnedRewards = _calculateRewards(stakedAmount, pool);
        }

        delete s.userStakes[user][poolId];
        pool.totalStaked -= stakedAmount;

        uint256 totalAmount = stakedAmount + earnedRewards;
        pool.token.safeTransfer(user, totalAmount);

        emit Unstaked(user, poolId, address(pool.token), stakedAmount, earnedRewards, force);
    }

    /** @notice Internal function to calculate rewards for a staked amount in a pool
     * @param amount The amount of tokens staked by the user
     * @param pool The pool for which to calculate rewards
     * @return The calculated rewards for the staked amount in the given pool
     */
    function _calculateRewards(uint256 amount, Pool memory pool) internal pure returns (uint256) {
        return (_calculateYearlyReward(amount, pool.apr) * pool.lockDuration) / SECONDS_IN_YEAR;
    }

    /**
     * @notice Internal function to calculate yearly rewards based on staked amount and APR
     * @param amount The amount of tokens staked by the user
     * @param apr The annual percentage rate for the pool
     * @return The calculated yearly rewards for the staked amount
     */
    function _calculateYearlyReward(uint256 amount, uint32 apr) internal pure returns (uint256) {
        return (amount * apr) / BPS;
    }

    /**
     * @notice Internal function to access the staking storage struct
     * @return s The staking storage struct containing all pools and user stakes
     */
    function _stakingStorage() internal pure returns (StakingStorage storage s) {
        // solhint-disable-next-line no-inline-assembly
        assembly {
            s.slot := _STAKING_STORAGE_SLOT
        }
    }

    /**
     * @notice Authorizes contract upgrade, allowing only the admin role to perform upgrades.
     * @param newImplementation The address of the new implementation contract
     */
    function _authorizeUpgrade(address newImplementation) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}
}
