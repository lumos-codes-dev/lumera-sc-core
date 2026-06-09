// solhint-disable gas-strict-inequalities
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {SafeERC20, IERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {ILURVesting} from "./interfaces/ILURVesting.sol";

/**
 * @title LURVesting
 * @author lumera
 * @notice This contract allows the owner to create vesting pools for beneficiaries and manage their vesting schedules.
 * @dev It uses OpenZeppelin's AccessControl for role-based access management and SafeERC20 for safe token transfers.
 */
contract LURVesting is ILURVesting, AccessControl {
    using SafeERC20 for IERC20;

    /**
     * @notice Role identifier for addresses that can manage vesting pools
     */
    bytes32 public constant VESTING_MANAGER_ROLE = keccak256("VESTING_MANAGER_ROLE");

    /**
     * @notice Constant for basis points denominator
     * @dev Used to represent percentages in basis points, where 10000 basis points equals 100%
     */
    uint256 public constant BASIS_POINTS_DENOMINATOR = 10000;

    /**
     * @notice Constant for maximum batch size
     * @dev Used to limit the number of beneficiaries in a single batch operation to prevent out-of-gas errors
     */
    uint256 public constant MAX_BATCH_SIZE = 100;

    /// @notice The token that is being vested
    IERC20 public token;

    /// @notice Amount of tokens which are reserved in vestings.
    /// @dev It is using for control allocation.
    uint256 public totalVested;

    /// @notice Mapping of recipient addresses to their vesting pools
    mapping(address recipient => Pool[] vestingPools) public pools;

    /**
     * @notice The constructor initializes the contract by setting up roles and vested token
     * @param vestedToken The address of the token to be vested
     * @param dao The address of the DAO contract which will have the DEFAULT_ADMIN_ROLE
     * @param vestingManager The address of the vesting manager who will have the VESTING_MANAGER_ROLE
     */
    constructor(address vestedToken, address dao, address vestingManager) {
        require(
            vestedToken != address(0) && dao != address(0) && vestingManager != address(0),
            LURVesting__ZeroAddress()
        );

        token = IERC20(vestedToken);

        _grantRole(DEFAULT_ADMIN_ROLE, dao);
        _grantRole(VESTING_MANAGER_ROLE, dao);
        _grantRole(VESTING_MANAGER_ROLE, vestingManager);

        _setRoleAdmin(VESTING_MANAGER_ROLE, DEFAULT_ADMIN_ROLE);
    }

    /**
     * @notice Function to create a new vesting pool
     * @param p The parameters for creating a custom vesting pool
     * @dev See `CreateVestingPoolParams` for details on the parameters
     */
    function createVestingPool(CreateVestingPoolParams calldata p) external onlyRole(VESTING_MANAGER_ROLE) {
        _createVestingPool(p);
    }

    /**
     * @notice Function to create vesting pools for multiple beneficiaries
     * @param p The parameters object array for creating custom vesting pools
     * @dev See `CreateVestingPoolParams` for details on the parameters
     */
    function createVestingPoolBatch(CreateVestingPoolParams[] calldata p) external onlyRole(VESTING_MANAGER_ROLE) {
        uint256 size = p.length;
        require(size != 0 && size <= MAX_BATCH_SIZE, LURVesting__InvalidBatchSize());

        for (uint256 i; i < p.length; ) {
            _createVestingPool(p[i]);

            unchecked {
                ++i;
            }
        }
    }

    /**
     * @notice Function to claim vested tokens for the caller
     * @dev It claims amount of tokens from all vesting pools of the caller
     */
    function claim() external {
        _claimFor(_msgSender());
    }

    /**
     * @notice Function to claim vested tokens for a specific recipient
     * @param recipient The address of the recipient who will receive the claimed tokens
     * @dev It claims amount of tokens from all vesting pools of the specified recipient.
     */
    function claimFor(address recipient) external {
        _claimFor(recipient);
    }

    /**
     * @notice Function to withdraw unused tokens from the contract
     * @param tokenAddress The address of the token to be withdrawn
     * @param recipient The address of the recipient who will receive the withdrawn tokens
     * @param amount The amount of tokens to be withdrawn
     * @dev Only tokens that are not reserved in vesting pools can be withdrawn.
     */
    function refund(address tokenAddress, address recipient, uint256 amount) external onlyRole(VESTING_MANAGER_ROLE) {
        require(tokenAddress != address(0) && recipient != address(0), LURVesting__ZeroAddress());
        IERC20 rToken = IERC20(tokenAddress);

        uint256 balance = rToken.balanceOf(address(this));
        uint256 withdrawableAmount;

        withdrawableAmount = address(rToken) == address(token)
            ? (balance > totalVested ? balance - totalVested : 0)
            : balance;

        require(withdrawableAmount >= amount, LURVesting__NotEnoughBalance(withdrawableAmount, amount));

        rToken.safeTransfer(recipient, amount);
        emit Refund(tokenAddress, recipient, amount);
    }

    /**
     * @notice Function to get the total claimable amount for a specific recipient
     * @param recipient The address of the recipient for whom to calculate the claimable amount
     * @return amount The total amount of tokens that can be claimed by the recipient from all their vesting pools
     */
    function getClaimableAmount(address recipient) external view returns (uint256 amount) {
        Pool[] storage totalPools = pools[recipient];

        for (uint256 i; i < totalPools.length; ++i) {
            amount += _getClaimableAmount(totalPools[i]);
        }
    }

    /**
     * @notice Internal function to create a new vesting pool
     * @param p The parameters for creating a custom vesting pool
     */
    function _createVestingPool(CreateVestingPoolParams memory p) internal {
        require(p.recipient != address(0), LURVesting__ZeroAddress());
        require(
            p.amount != 0 && p.schedule.periodDuration != 0 && p.schedule.periodCount != 0,
            LURVesting__ZeroAmount()
        );
        require(p.initialUnlockPercent <= BASIS_POINTS_DENOMINATOR, LURVesting__InitialUnlockExceedsLimit());

        token.safeTransferFrom(_msgSender(), address(this), p.amount);

        Pool memory pool = Pool({
            amount: p.amount,
            start: p.start > block.timestamp ? p.start : block.timestamp,
            schedule: p.schedule,
            initialUnlockPercent: p.initialUnlockPercent,
            claimed: 0
        });
        pools[p.recipient].push(pool);
        totalVested += p.amount;

        emit VestingPoolCreated(p.recipient, pool);
    }

    /**
     * @notice Internal function to claim vested tokens for a specific recipient
     * @param recipient The address of the recipient who will receive the claimed tokens
     */
    function _claimFor(address recipient) internal {
        Pool[] storage totalPools = pools[recipient];
        require(totalPools.length != 0, LURVesting__NoAllocationsFound());

        uint256 totalAmount;

        for (uint256 i = totalPools.length; i > 0; ) {
            --i;
            uint256 amount = _getClaimableAmount(totalPools[i]);
            if (amount != 0) {
                totalPools[i].claimed += amount;
                totalAmount += amount;
            }

            if (totalPools[i].claimed == totalPools[i].amount) {
                uint256 lastIndex = totalPools.length - 1;
                if (i != lastIndex) {
                    totalPools[i] = totalPools[lastIndex];
                }
                totalPools.pop();
            }
        }
        require(totalAmount != 0, LURVesting__ZeroAmount());

        totalVested -= totalAmount;
        token.safeTransfer(recipient, totalAmount);

        emit Claim(recipient, totalAmount);
    }

    /**
     * @notice Internal function to get the claimable amount for a specific vesting pool
     * @param pool The vesting pool for which to calculate the claimable amount
     * @return The amount of tokens that can be claimed from the vesting pool
     */
    function _getClaimableAmount(Pool storage pool) internal view returns (uint256) {
        uint256 unlockedAmount = _calculateUnlockedAmount(pool);
        return (unlockedAmount > pool.claimed) ? unlockedAmount - pool.claimed : 0;
    }

    /**
     * @notice Internal function to calculate the total unlocked amount for a specific vesting pool
     * @param pool The vesting pool for which to calculate the unlocked amount
     * @return The total amount of tokens that have been unlocked according to the vesting schedule
     */
    function _calculateUnlockedAmount(Pool memory pool) internal view returns (uint256) {
        Schedule memory schedule = pool.schedule;
        uint256 cliffEndTimestamp = pool.start + schedule.cliffDuration;
        uint256 currentTimestamp = block.timestamp;

        if (currentTimestamp < cliffEndTimestamp) return 0;

        uint256 totalAmount = pool.amount;
        uint256 initialAmount = (totalAmount * pool.initialUnlockPercent) / BASIS_POINTS_DENOMINATOR;

        uint256 passedPeriods = (currentTimestamp - pool.start - schedule.cliffDuration) / schedule.periodDuration;

        return
            passedPeriods >= schedule.periodCount
                ? totalAmount
                : (((totalAmount - initialAmount) * (passedPeriods)) / schedule.periodCount) + initialAmount;
    }
}
