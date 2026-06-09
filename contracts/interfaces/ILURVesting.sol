// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/**
 * @title ILURVesting
 * @author lumera
 * @notice Interface for the LUR Vesting contract
 */
interface ILURVesting {
    /**
     * @notice Structure to define a vesting schedule
     * @param cliffDuration The duration of the cliff period in seconds.
     * @param periodDuration The duration of each vesting period in seconds.
     * @param periodCount The number of vesting periods.
     */
    struct Schedule {
        uint256 cliffDuration;
        uint256 periodDuration;
        uint256 periodCount;
    }

    /**
     * @notice Structure to define a vesting pool for a recipient
     * @param amount The total amount of tokens to be vested in the pool.
     * @param start The timestamp when the vesting timeline starts.
     * @param schedule The vesting schedule associated with the pool.
     * @param initialUnlockPercent The percentage of tokens that can be claimed immediately after the cliff
     * @param claimed The amount of tokens that have already been claimed from the pool.
     */
    struct Pool {
        uint256 amount;
        uint256 start;
        Schedule schedule;
        uint256 initialUnlockPercent;
        uint256 claimed;
    }

    /**
     * @notice Structure to define the parameters for creating a vesting pool
     * @param recipient The address of the recipient who will receive the vested tokens.
     * @param amount The total amount of tokens to be vested.
     * @param start The timestamp when the vesting timeline starts.
     * @param schedule The vesting schedule.
     * @param initialUnlockPercent The percentage of tokens that can be claimed immediately after the cliff
     */
    struct CreateVestingPoolParams {
        address recipient;
        uint256 amount;
        uint256 start;
        Schedule schedule;
        uint256 initialUnlockPercent;
    }

    /**
     * @notice Event emitted when a new vesting pool is created
     * @param recipient The address of the recipient who will receive the vested tokens.
     * @param pool The details of the created vesting pool.
     */
    event VestingPoolCreated(address indexed recipient, Pool pool);

    /**
     * @notice Event emitted when vested tokens are claimed by a recipient
     * @param recipient The address of the recipient who claimed the tokens.
     * @param amount The amount of tokens that were claimed.
     */
    event Claim(address indexed recipient, uint256 indexed amount);

    /**
     * @notice Event emitted when unused tokens are withdrawn from the contract
     * @param token The address of the token that was withdrawn
     * @param recipient The address of the recipient who received the withdrawn tokens
     * @param amount The amount of tokens that were withdrawn
     */
    event Refund(address indexed token, address indexed recipient, uint256 indexed amount);

    /**
     * @notice Error thrown when a zero address is provided
     */
    error LURVesting__ZeroAddress();

    /**
     * @notice Error thrown when invalid batch size is provided
     */
    error LURVesting__InvalidBatchSize();

    /**
     * @notice Error thrown when a zero amount is provided
     */
    error LURVesting__ZeroAmount();

    /**
     * @notice Error thrown when the balance is not enough for the requested operation
     * @param available The available balance in the contract
     * @param required The required balance
     */
    error LURVesting__NotEnoughBalance(uint256 available, uint256 required);

    /**
     * @notice Error thrown when the initial unlock percentage exceeds the limit of 100% (10000 basis points)
     */
    error LURVesting__InitialUnlockExceedsLimit();

    /**
     * @notice Error thrown when no vesting allocations are found for a recipient
     */
    error LURVesting__NoAllocationsFound();
}
