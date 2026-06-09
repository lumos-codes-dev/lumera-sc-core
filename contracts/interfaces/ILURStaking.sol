// solhint-disable gas-struct-packing
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title ILURStaking
 * @author lumera
 * @notice Interface for staking pools that allow users to stake tokens to earn rewards
 */
interface ILURStaking {
    /**
     * @notice Struct to hold parameters for creating a new staking pool
     * @param name Name of the pool
     * @param token Address of the ERC20 token for this pool
     * @param apr Annual percentage rate for rewards pools (in basis points)
     * @param lockDuration Duration for which tokens are locked after staking
     * @param minStakeAmount Minimum amount required to stake in the pool
     * @param maxStakeAmount Maximum amount allowed to stake in the pool
     */
    struct CreatePoolParams {
        string name;
        address token;
        uint32 apr;
        uint32 lockDuration;
        uint256 minStakeAmount;
        uint256 maxStakeAmount;
    }

    /**
     * @notice Struct to hold parameters for pool information
     * @param name Name of the pool
     * @param token Address of the ERC20 token for this pool
     * @param apr Annual percentage rate for rewards pools (in basis points)
     * @param lockDuration Duration for which tokens are locked after staking
     * @param minStakeAmount Minimum amount required to stake in the pool
     * @param maxStakeAmount Maximum amount allowed to stake in the pool
     * @param stakingPaused Whether staking is paused for this pool
     * @param unstakingPaused Whether unstaking is paused for this pool
     * @param totalStaked Total amount staked in the pool
     */
    struct Pool {
        string name;
        IERC20 token;
        uint32 apr;
        uint32 lockDuration;
        uint256 minStakeAmount;
        uint256 maxStakeAmount;
        bool stakingPaused;
        bool unstakingPaused;
        uint256 totalStaked;
    }

    /**
     * @notice Struct to hold extended pool information for a specific user
     * @param id ID of the pool
     * @param name Name of the pool
     * @param token ERC20 token for this pool
     * @param apr Annual percentage rate for rewards pools (in basis points)
     * @param lockDuration Duration for which tokens are locked after staking
     * @param minStakeAmount Minimum amount required to stake in the pool
     * @param maxStakeAmount Maximum amount allowed to stake in the pool
     * @param stakingPaused Whether staking is paused for this pool
     * @param unstakingPaused Whether unstaking is paused for this pool
     * @param totalStaked Total amount staked in the pool
     * @param stakedByUser Amount staked by the user in this pool
     * @param stakedByUserAt Timestamp when the user last staked in this pool
     * @param lockedUntilForUser Timestamp until which the user's staked tokens are locked
     * @param pendingRewards Amount of rewards pending for the user in this pool
     * @param isTokensLocked Whether the user's staked tokens are currently locked
     */
    struct UserPoolExtended {
        uint256 id;
        string name;
        IERC20 token;
        uint32 apr;
        uint32 lockDuration;
        uint256 minStakeAmount;
        uint256 maxStakeAmount;
        bool stakingPaused;
        bool unstakingPaused;
        uint256 totalStaked;
        uint256 stakedByUser;
        uint256 stakedByUserAt;
        uint256 lockedUntilForUser;
        uint256 pendingRewards;
        bool isTokensLocked;
    }

    /**
     * @notice Struct to hold user stake information for a specific pool
     * @param staked Amount of tokens staked by the user in the pool
     * @param lockUntil Timestamp until which the user's staked tokens are locked
     */
    struct UserStake {
        uint256 staked;
        uint256 lockUntil;
    }

    /**
     * @notice Event emitted when a pool is created
     * @param poolId ID of the created pool
     * @param token Address of the token for this pool
     */
    event PoolCreated(uint256 indexed poolId, address indexed token);

    /**
     * @notice Event emitted when a user stakes tokens in a pool
     * @param user Address of the user who staked
     * @param poolId ID of the pool in which tokens were staked
     * @param token Address of the token staked
     * @param amount Amount of tokens staked
     * @param lockUntil Timestamp until which the tokens are locked
     * @param rewards Amount of rewards earned during the stake
     */
    event Staked(
        address indexed user,
        uint256 indexed poolId,
        address indexed token,
        uint256 amount,
        uint256 lockUntil,
        uint256 rewards
    );

    /**
     * @notice Event emitted when a user unstakes tokens from a pool
     * @param user Address of the user who unstaked
     * @param poolId ID of the pool from which tokens were unstaked
     * @param token Address of the token unstaked
     * @param amount Amount of tokens unstaked
     * @param rewards Amount of rewards earned during the stake
     * @param forced Whether the unstake was forced (e.g., due to lock expiration)
     */
    event Unstaked(
        address indexed user,
        uint256 indexed poolId,
        address indexed token,
        uint256 amount,
        uint256 rewards,
        bool forced
    );

    /**
     * @notice Event emitted when staking is paused for a pool
     * @param poolId ID of the pool for which staking was paused
     * @param paused Whether staking is paused (true) or resumed (false)
     */
    event StakingPausedUpdated(uint256 indexed poolId, bool indexed paused);

    /**
     * @notice Event emitted when unstaking is paused for a pool
     * @param poolId ID of the pool for which unstaking was paused
     * @param paused Whether unstaking is paused (true) or resumed (false)
     */
    event UnstakingPausedUpdated(uint256 indexed poolId, bool indexed paused);

    /**
     * @notice Event emitted when tokens are refunded from the contract
     * @param token The address of the ERC20 token (or zero address for Ether) that was refunded.
     * @param to The address of the account that received the refunded tokens.
     * @param amount The amount of tokens that were refunded.
     */
    event Refund(address indexed token, address indexed to, uint256 indexed amount);

    /// @notice Errors
    error LURStaking__ZeroAddress();
    error LURStaking__InvalidName();
    error LURStaking__ZeroAmount();
    error LURStaking__InvalidAmounts();
    error LURStaking__PoolNotExists();
    error LURStaking__StakingPaused();
    error LURStaking__AmountTooLow();
    error LURStaking__AmountTooHigh();
    error LURStaking__UnstakingPaused();
    error LURStaking__WithdrawAmountExceedsWithdrawableBalance();
    error LURStaking__TransferFailed();
    error LURStaking__TokensLocked();
}
