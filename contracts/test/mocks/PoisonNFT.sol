// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

/// @notice Test-only NFT whose tokenURI returns attacker-chosen metadata.
contract PoisonNFT is ERC721 {
    string private uri;

    constructor(string memory uri_) ERC721("Free Mint Pass", "FMP") {
        uri = uri_;
    }

    function mint(address to, uint256 id) external {
        _mint(to, id);
    }

    function tokenURI(uint256) public view override returns (string memory) {
        return uri;
    }
}
