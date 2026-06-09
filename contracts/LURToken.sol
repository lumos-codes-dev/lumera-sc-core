// solhint-disable func-name-mixedcase
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {Nonces} from "@openzeppelin/contracts/utils/Nonces.sol";
import {ERC20Votes} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";

/**
 * @title LURToken
 * @author lumera
 * @notice This contract implements a governance token with voting capabilities and permit functionality.
 * @dev It extends OpenZeppelin's ERC20, ERC20Permit, and ERC20Votes contracts.
 */
contract LURToken is ERC20, ERC20Permit, ERC20Votes {
    /**
     * @notice Constructor to initialize the LURToken contract
     * @dev Sets the token name and symbol and mints an initial supply
     * @param initialOwner The address of the initial token owner
     * @param initialSupply The amount of tokens to mint for the initial owner
     */
    constructor(address initialOwner, uint256 initialSupply) ERC20("LUR Token", "LUR") ERC20Permit("LUR Token") {
        _mint(initialOwner, initialSupply);
    }

    /**
     * @notice Function to get the current nonce for a given owner
     * @param owner The address of the owner whose nonce is being queried
     * @return The current nonce for the owner
     * @dev This function overrides the nonces function from ERC20Permit and Nonces
     */
    function nonces(address owner) public view override(ERC20Permit, Nonces) returns (uint256) {
        return super.nonces(owner);
    }

    /**
     * @notice Function to get the current timepoint for voting power tracking
     * @return The current timestamp
     */
    function clock() public view override returns (uint48) {
        return uint48(block.timestamp);
    }

    /**
     * @notice Function to describe the clock mode for voting power tracking
     * @return The clock mode description
     */
    function CLOCK_MODE() public pure override returns (string memory) {
        return "mode=timestamp";
    }

    /**
     * @notice Function override the _update function to ensure compatibility with ERC20Votes
     * @param from The address from which tokens are being transferred
     * @param to The address to which tokens are being transferred
     * @param value The amount of tokens being transferred
     * @dev This function is required to ensure that the voting power is updated correctly
     */
    function _update(address from, address to, uint256 value) internal override(ERC20, ERC20Votes) {
        super._update(from, to, value);
    }
}
