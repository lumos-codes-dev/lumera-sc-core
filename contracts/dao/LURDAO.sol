// solhint-disable max-line-length, func-name-mixedcase
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Governor} from "@openzeppelin/contracts/governance/Governor.sol";
import {GovernorSettings} from "@openzeppelin/contracts/governance/extensions/GovernorSettings.sol";
import {GovernorCountingSimple} from "@openzeppelin/contracts/governance/extensions/GovernorCountingSimple.sol";
import {GovernorVotes} from "@openzeppelin/contracts/governance/extensions/GovernorVotes.sol";
import {IVotes} from "@openzeppelin/contracts/governance/utils/IVotes.sol";
import {GovernorVotesQuorumFraction} from "@openzeppelin/contracts/governance/extensions/GovernorVotesQuorumFraction.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {GovernorTimelockControl} from "@openzeppelin/contracts/governance/extensions/GovernorTimelockControl.sol";

/**
 * @title LURDAO
 * @author lumera
 * @notice This contract implements a DAO governance system using OpenZeppelin's Governor framework.
 * @dev It allows for proposal creation, voting, and execution of proposals with a timelock mechanism.
 */
contract LURDAO is
    Governor,
    GovernorSettings,
    GovernorCountingSimple,
    GovernorVotes,
    GovernorVotesQuorumFraction,
    GovernorTimelockControl
{
    /**
     * @notice Constructor to initialize the LURDAO contract
     * @param _token The address of the token used for voting
     * @param _timelock The address of the timelock controller for proposal execution
     * @param _votingDelay The delay before voting starts
     * @param _votingPeriod The duration of the voting period
     * @param _proposalThreshold The minimum number of tokens required to create a proposal
     * @param _quorumPercentage The percentage of total supply required for quorum
     */
    constructor(
        IVotes _token,
        TimelockController _timelock,
        uint48 _votingDelay,
        uint32 _votingPeriod,
        uint256 _proposalThreshold,
        uint256 _quorumPercentage
    )
        Governor("LURDAO")
        GovernorSettings(_votingDelay, _votingPeriod, _proposalThreshold)
        GovernorVotes(_token)
        GovernorVotesQuorumFraction(_quorumPercentage)
        GovernorTimelockControl(_timelock)
    {}

    /**
     * @notice Function to get the threshold for proposal creation
     * @return The minimum number of tokens required to create a proposal
     */
    function proposalThreshold() public view override(Governor, GovernorSettings) returns (uint256) {
        return super.proposalThreshold();
    }

    /**
     * @notice Function to get the current state of a proposal
     * @param proposalId The ID of the proposal to check
     * @return The current state of the proposal
     */
    function state(uint256 proposalId) public view override(Governor, GovernorTimelockControl) returns (ProposalState) {
        return super.state(proposalId);
    }

    /**
     * @notice Function to check if a proposal needs queuing
     * @param proposalId The ID of the proposal to check
     * @return True if the proposal needs queuing, false otherwise
     */
    function proposalNeedsQueuing(
        uint256 proposalId
    ) public view override(Governor, GovernorTimelockControl) returns (bool) {
        return super.proposalNeedsQueuing(proposalId);
    }

    /**
     * @notice Function to get the current timepoint for voting
     * @return The current timestamp
     */
    function clock() public view override(Governor, GovernorVotes) returns (uint48) {
        return uint48(block.timestamp);
    }

    /**
     * @notice Function to describe the clock mode
     * @return The clock mode description
     */
    function CLOCK_MODE() public pure override(Governor, GovernorVotes) returns (string memory) {
        return "mode=timestamp";
    }

    /**
     * @notice Function to queue operations for a proposal
     * @param proposalId The ID of the proposal to queue
     * @param targets The addresses of the contracts to call
     * @param values The amounts of Ether to send with each call
     * @param calldatas The data to send with each call
     * @param descriptionHash The hash of the proposal description
     * @return The timestamp when the proposal will be executable
     */
    function _queueOperations(
        uint256 proposalId,
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    ) internal override(Governor, GovernorTimelockControl) returns (uint48) {
        return super._queueOperations(proposalId, targets, values, calldatas, descriptionHash);
    }

    /**
     * @notice Function to execute operations for a proposal
     * @param proposalId The ID of the proposal to execute
     * @param targets The addresses of the contracts to call
     * @param values The amounts of Ether to send with each call
     * @param calldatas The data to send with each call
     * @param descriptionHash The hash of the proposal description
     */
    function _executeOperations(
        uint256 proposalId,
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    ) internal override(Governor, GovernorTimelockControl) {
        super._executeOperations(proposalId, targets, values, calldatas, descriptionHash);
    }

    /**
     * @notice Function to cancel a proposal
     * @param targets The addresses of the contracts to call
     * @param values The amounts of Ether to send with each call
     * @param calldatas The data to send with each call
     * @param descriptionHash The hash of the proposal description
     * @return The ID of the cancelled proposal
     */
    function _cancel(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    ) internal override(Governor, GovernorTimelockControl) returns (uint256) {
        return super._cancel(targets, values, calldatas, descriptionHash);
    }

    /**
     * @notice Function to get the executor address for proposal execution
     * @return The address of the executor
     */
    function _executor() internal view override(Governor, GovernorTimelockControl) returns (address) {
        return super._executor();
    }
}
