// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/**
 * @title ILURVesting
 * @author lumera
 * @notice Interface for the LUR Vesting contract
 */
interface ILURVesting {
    /**
     * @notice Structure to define a vesting pool rules
     * @param name The name of the vesting pool
     * @param cliffDuration The duration of the cliff period in seconds.
     * @param periodDuration The duration of each vesting period in seconds.
     * @param periodCount The number of vesting periods.
     * @param initialUnlockPercent The percentage of tokens that can be claimed immediately after the cliff
     */
    struct Pool {
        string name;
        uint256 cliffDuration;
        uint256 periodDuration;
        uint256 periodCount;
        uint256 initialUnlockPercent;
        bool claimPaused;
    }

    /**
     * @notice Structure defining a user's allocation within a pool
     * @param total Total tokens allocated
     * @param claimed Tokens already claimed
     * @param start Vesting start timestamp
     */
    struct UserAllocation {
        uint256 total;
        uint256 claimed;
        uint256 start;
    }

    /**
     * @notice Structure to define the parameters for creating a vesting pool
     * @param name The name of the vesting pool
     * @param cliffDuration The duration of the cliff period in seconds.
     * @param periodDuration The duration of each vesting period in seconds.
     * @param periodCount The number of vesting periods.
     * @param initialUnlockPercent The percentage of tokens that can be claimed immediately after the cliff
     */
    struct CreatePoolParams {
        string name;
        uint256 cliffDuration;
        uint256 periodDuration;
        uint256 periodCount;
        uint256 initialUnlockPercent;
    }

    /**
     * @notice Parameters for a single allocation entry in a batch
     */
    struct AllocateParams {
        address recipient;
        uint256 amount;
        uint256 start;
    }

    /**
     * @notice Extended pool info with per-user allocation details, used in getPools()
     * @param id The ID of the vesting pool
     * @param name The name of the vesting pool
     * @param cliffDuration The duration of the cliff period in seconds.
     * @param periodDuration The duration of each vesting period in seconds.
     * @param periodCount The number of vesting periods.
     * @param initialUnlockPercent The percentage of tokens that can be claimed immediately after the cliff
     * @param claimPaused Whether claiming is paused for this pool
     * @param allocatedForUser The total tokens allocated for the user
     * @param claimedByUser The tokens already claimed by the user
     * @param startForUser The vesting start timestamp for the user
     * @param claimableForUser The tokens currently claimable by the user
     */
    struct UserPoolExtended {
        uint256 id;
        string name;
        uint256 cliffDuration;
        uint256 periodDuration;
        uint256 periodCount;
        uint256 initialUnlockPercent;
        bool claimPaused;
        uint256 allocatedForUser;
        uint256 claimedByUser;
        uint256 startForUser;
        uint256 claimableForUser;
    }

    event PoolCreated(
        uint256 indexed poolId,
        string name,
        uint256 cliffDuration,
        uint256 periodDuration,
        uint256 periodCount,
        uint256 initialUnlockPercent
    );

    event Allocated(uint256 indexed poolId, address indexed recipient, uint256 amount, uint256 start);

    event Claim(address indexed recipient, uint256 indexed poolId, uint256 amount);

    event Refund(address indexed token, address indexed recipient, uint256 amount);

    error LURVesting__ZeroAddress();
    error LURVesting__ZeroAmount();
    error LURVesting__InvalidName();
    error LURVesting__InitialUnlockExceedsLimit();
    error LURVesting__NotEnoughBalance(uint256 available, uint256 required);
    error LURVesting__NoAllocationsFound();
    error LURVesting__AlreadyAllocated();
    error LURVesting__PoolNotExists();
    error LURVesting__ClaimPaused();
    error LURVesting__InvalidBatchSize();
}
