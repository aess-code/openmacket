
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import "../libraries/MathLibrary.sol";
contract MathWrapper {
    function testMulDiv(uint256 a, uint256 b, uint256 d) external pure returns (uint256) {
        return MathLibrary.mulDiv(a, b, d);
    }
    function testComputeIndex(uint256 f, uint256 a) external pure returns (uint256) {
        return MathLibrary.computeIndex(f, a);
    }
}
