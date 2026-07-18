// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./Market.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract MarketFactory is Ownable {
    address public immutable usdtAddress;
    address public treasury;
    address[] public allMarkets;

    event MarketCreated(address indexed market, address indexed creator, string question, uint256 timestamp);
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);

    constructor(address _usdtAddress, address _treasury) Ownable(msg.sender) {
        require(_usdtAddress != address(0), "Invalid USDT address");
        require(_treasury != address(0), "Invalid Treasury address");
        usdtAddress = _usdtAddress;
        treasury = _treasury;
    }

    function setTreasury(address _newTreasury) external onlyOwner {
        require(_newTreasury != address(0), "Invalid Treasury address");
        emit TreasuryUpdated(treasury, _newTreasury);
        treasury = _newTreasury;
    }

    function createMarket(string calldata _question, string calldata _description) external returns (address) {
        require(bytes(_question).length > 5 && bytes(_question).length <= 300, "Invalid question");
        
        // Pass the treasury address to the Market constructor
        Market newMarket = new Market(
            _question,
            _description,
            msg.sender,
            usdtAddress,
            treasury
        );
        
        allMarkets.push(address(newMarket));
        emit MarketCreated(address(newMarket), msg.sender, _question, block.timestamp);
        
        return address(newMarket);
    }

    function getMarketCount() external view returns (uint256) {
        return allMarkets.length;
    }

    function getMarkets(uint256 offset, uint256 limit) external view returns (address[] memory) {
        uint256 total = allMarkets.length;
        if (offset >= total) return new address[](0);
        
        uint256 size = offset + limit > total ? total - offset : limit;
        address[] memory result = new address[](size);
        
        for (uint256 i = 0; i < size; i++) {
            result[i] = allMarkets[offset + i];
        }
        
        return result;
    }
}
