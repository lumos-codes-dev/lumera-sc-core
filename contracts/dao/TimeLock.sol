// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";

/**
 * @title TimeLock
 * @author lumera
 * @notice This contract implements a timelock mechanism for governance proposals.
 * @dev It extends OpenZeppelin's TimelockController to manage delayed execution of proposals.
 */
contract TimeLock is TimelockController {
    /**
     * @notice Constructor to initialize the TimeLock contract
     * @param minDelay The minimum delay for executing a proposal after it has been queued
     * @param proposers The list of addresses that have the proposer role, allowing them to queue proposals
     * @param executors The list of addresses that have the executor role, allowing them to execute proposals
     * @param admin The address of the admin (can be zero address)
     */
    constructor(
        uint256 minDelay,
        address[] memory proposers,
        address[] memory executors,
        address admin
    ) TimelockController(minDelay, proposers, executors, admin) {}
}
