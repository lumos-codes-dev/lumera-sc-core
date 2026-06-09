// solhint-disable func-name-mixedcase, ordering
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";

/**
 * @title PausableExtUpgradeable
 * @author lumera
 * @notice Extends the OpenZeppelin's {PausableUpgradeable} contract by adding the {PAUSER_ROLE} role and implementing
 *      the external pausing and unpausing functions.
 */
abstract contract PausableExtUpgradeable is Initializable, AccessControlUpgradeable, PausableUpgradeable {
    /**
     * @notice Role identifier for the pauser role, which allows to pause and unpause the contract.
     */
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    /**
     * @notice Initializes the contract by setting up the necessary roles and pausable functionality.
     * @dev This function should be called in the initializer of the contract that inherits from this one.
     */
    function __PausableExt_init_unchained() internal onlyInitializing {
        __AccessControl_init_unchained();
        __Pausable_init_unchained();

        _setRoleAdmin(PAUSER_ROLE, DEFAULT_ADMIN_ROLE);
    }

    /**
     * @notice Triggers the paused state of the contract.
     * @dev Requirement: the caller must have the {PAUSER_ROLE} role.
     */
    function pause() public onlyRole(PAUSER_ROLE) {
        _pause();
    }

    /**
     * @notice Triggers the unpaused state of the contract.
     * @dev Requirement: the caller must have the {PAUSER_ROLE} role.
     */
    function unpause() public onlyRole(PAUSER_ROLE) {
        _unpause();
    }
}
