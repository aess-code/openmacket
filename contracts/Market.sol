// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title Pulse Viewstake Market v4
/// @notice Pure confidence-index-driven dual-pool prediction market.
///         Price = current confidence index. No oracle, no external input.
contract Market is ERC1155, ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    uint256 public constant YES = 0;
    uint256 public constant NO  = 1;

    string  public question;
    string  public description;
    address public immutable creator;
    address public immutable usdt;
    address public immutable treasury;   // treasury A: 0.3%
    address public immutable treasuryB;  // treasury B: 0.2%

    // 1 USDT = SHARE_SCALE raw share units (precision layer)
    uint256 private constant SHARE_SCALE = 1_000_000;

    // Virtual liquidity seed: 1 USDT worth on each side at init
    // Prevents div-by-zero and keeps price in (0, 1) open interval
    uint256 private constant VIRTUAL_SEED = 1 * SHARE_SCALE;

    // Real user-owned supplies (excludes virtual seed)
    uint256 public yesSupply;
    uint256 public noSupply;

    uint8 public constant STATUS_OPEN    = 0;
    uint8 public constant STATUS_CLOSING = 1;
    uint8 public constant STATUS_SETTLED = 2;
    uint8 public status;

    bool    public isClosed;
    uint256 public closingTimestamp;
    uint256 private constant SETTLEMENT_DELAY = 21 days;

    bool public settledYesWins;
    bool public isTie;

    uint256 public totalVolume;
    uint256 public participantCount;
    uint256 public createdAt;
    mapping(address => bool) public hasParticipated;
    mapping(address => bool) public claimed;

    // Fees (basis points, denom = 10_000)
    uint256 private constant CREATOR_FEE_BPS    = 50;  // 0.5%
    uint256 private constant TREASURY_A_FEE_BPS = 30;  // 0.3%
    uint256 private constant TREASURY_B_FEE_BPS = 20;  // 0.2%
    uint256 private constant BPS_DENOM          = 10_000;

    event Bought(address indexed user, uint256 side, uint256 usdtIn, uint256 sharesOut);
    event Sold(address indexed user, uint256 side, uint256 sharesIn, uint256 usdtOut);
    event MarketClosing(address indexed initiator, uint256 settlementTime);
    event MarketSettled(bool yesWins, bool tie);
    event Claimed(address indexed user, uint256 amount);

    constructor(
        string memory _question,
        string memory _description,
        address _creator,
        address _usdt,
        address _treasury,
        address _treasuryB
    ) ERC1155("") Ownable(_creator) {
        question    = _question;
        description = _description;
        creator     = _creator;
        usdt        = _usdt;
        treasury    = _treasury;
        treasuryB   = _treasuryB;
        status      = STATUS_OPEN;
        createdAt   = block.timestamp;
    }

    // Effective supply including virtual seed (used for price calculation only)
    function _yesEff()   private view returns (uint256) { return yesSupply + VIRTUAL_SEED; }
    function _noEff()    private view returns (uint256) { return noSupply  + VIRTUAL_SEED; }
    function _totalEff() private view returns (uint256) { return _yesEff() + _noEff(); }

    /// @notice YES confidence in basis points (5000 = 50.00%)
    function getConfidence() external view returns (uint256) {
        return (_yesEff() * BPS_DENOM) / _totalEff();
    }

    /// @notice Real USDT locked in pool (excludes virtual seed)
    function getTVL() external view returns (uint256) {
        return (yesSupply + noSupply) / SHARE_SCALE;
    }

    function timeUntilSettlement() public view returns (uint256) {
        if (status != STATUS_CLOSING) return 0;
        if (block.timestamp >= closingTimestamp + SETTLEMENT_DELAY) return 0;
        return (closingTimestamp + SETTLEMENT_DELAY) - block.timestamp;
    }

    /// @notice Returns user position with index-based USDT value
    function getUserPosition(address user)
        external view
        returns (uint256 yesBal, uint256 noBal, uint256 yesValueUSDT, uint256 noValueUSDT)
    {
        yesBal = balanceOf(user, YES);
        noBal  = balanceOf(user, NO);
        uint256 te = _totalEff();
        // value = shares * sidePrice / SHARE_SCALE  where sidePrice = sideEff/totalEff
        yesValueUSDT = (yesBal * _yesEff()) / (te * SHARE_SCALE);
        noValueUSDT  = (noBal  * _noEff())  / (te * SHARE_SCALE);
    }

    /// @notice Claimable USDT after settlement
    function getClaimAmount(address user) public view returns (uint256) {
        if (status != STATUS_SETTLED) return 0;
        if (claimed[user]) return 0;
        uint256 yesBal = balanceOf(user, YES);
        uint256 noBal  = balanceOf(user, NO);
        if (isTie) {
            // Refund at face value
            return (yesBal + noBal) / SHARE_SCALE;
        }
        uint256 totalPool = (yesSupply + noSupply) / SHARE_SCALE;
        if (settledYesWins) {
            if (yesBal == 0 || yesSupply == 0) return 0;
            return (yesBal * totalPool) / yesSupply;
        } else {
            if (noBal == 0 || noSupply == 0) return 0;
            return (noBal * totalPool) / noSupply;
        }
    }

    /// @notice Buy YES or NO. Allowed while Open or Closing.
    function buy(uint256 side, uint256 usdtAmount) external nonReentrant {
        require(status == STATUS_OPEN || status == STATUS_CLOSING, "Market not active");
        require(usdtAmount > 0, "Amount > 0");
        require(side == YES || side == NO, "Invalid side");

        IERC20(usdt).safeTransferFrom(msg.sender, address(this), usdtAmount);

        // Creator fee is 0 during Closing (stays in pool for winners)
        uint256 creatorFee   = (status == STATUS_OPEN)
            ? (usdtAmount * CREATOR_FEE_BPS) / BPS_DENOM
            : 0;
        uint256 treasuryAFee = (usdtAmount * TREASURY_A_FEE_BPS) / BPS_DENOM;
        uint256 treasuryBFee = (usdtAmount * TREASURY_B_FEE_BPS) / BPS_DENOM;
        uint256 netUsdt      = usdtAmount - creatorFee - treasuryAFee - treasuryBFee;

        if (creatorFee   > 0) IERC20(usdt).safeTransfer(creator,   creatorFee);
        if (treasuryAFee > 0) IERC20(usdt).safeTransfer(treasury,  treasuryAFee);
        if (treasuryBFee > 0) IERC20(usdt).safeTransfer(treasuryB, treasuryBFee);

        // Shares = netUsdt * SHARE_SCALE * totalEff / sideEff
        // (equivalent to: netUsdt / sidePrice, where sidePrice = sideEff/totalEff)
        uint256 te     = _totalEff();
        uint256 se     = (side == YES) ? _yesEff() : _noEff();
        uint256 shares = (netUsdt * SHARE_SCALE * te) / se;

        if (side == YES) { yesSupply += shares; } else { noSupply += shares; }
        _mint(msg.sender, side, shares, "");

        totalVolume += usdtAmount;
        if (!hasParticipated[msg.sender]) {
            hasParticipated[msg.sender] = true;
            participantCount += 1;
        }

        emit Bought(msg.sender, side, usdtAmount, shares);
    }

    /// @notice Sell YES or NO shares. Allowed while Open or Closing.
    function sell(uint256 side, uint256 shares) external nonReentrant {
        require(status == STATUS_OPEN || status == STATUS_CLOSING, "Market not active");
        require(shares > 0, "Shares > 0");
        require(side == YES || side == NO, "Invalid side");
        require(balanceOf(msg.sender, side) >= shares, "Insufficient balance");

        // grossUsdt = shares * sidePrice / SHARE_SCALE = shares * sideEff / (totalEff * SHARE_SCALE)
        uint256 te        = _totalEff();
        uint256 se        = (side == YES) ? _yesEff() : _noEff();
        uint256 grossUsdt = (shares * se) / (te * SHARE_SCALE);
        require(grossUsdt > 0, "Amount too small");

        // Creator fee is 0 during Closing
        uint256 creatorFee   = (status == STATUS_OPEN)
            ? (grossUsdt * CREATOR_FEE_BPS) / BPS_DENOM
            : 0;
        uint256 treasuryAFee = (grossUsdt * TREASURY_A_FEE_BPS) / BPS_DENOM;
        uint256 treasuryBFee = (grossUsdt * TREASURY_B_FEE_BPS) / BPS_DENOM;
        uint256 netToUser    = grossUsdt - creatorFee - treasuryAFee - treasuryBFee;

        if (side == YES) { yesSupply -= shares; } else { noSupply -= shares; }
        _burn(msg.sender, side, shares);

        IERC20(usdt).safeTransfer(msg.sender, netToUser);
        if (creatorFee   > 0) IERC20(usdt).safeTransfer(creator,   creatorFee);
        if (treasuryAFee > 0) IERC20(usdt).safeTransfer(treasury,  treasuryAFee);
        if (treasuryBFee > 0) IERC20(usdt).safeTransfer(treasuryB, treasuryBFee);

        totalVolume += grossUsdt;
        emit Sold(msg.sender, side, shares, netToUser);
    }

    /// @notice Creator initiates close. Irreversible. 21-day countdown begins.
    function initiateClose() external onlyOwner {
        require(status == STATUS_OPEN, "Not open");
        status           = STATUS_CLOSING;
        closingTimestamp = block.timestamp;
        isClosed         = true;
        emit MarketClosing(msg.sender, block.timestamp + SETTLEMENT_DELAY);
    }

    /// @notice Anyone can trigger settlement after 21 days.
    ///         Result auto-calculated from final confidence index (uses virtual seed).
    function settle() external {
        require(status == STATUS_CLOSING, "Not in closing");
        require(block.timestamp >= closingTimestamp + SETTLEMENT_DELAY, "Delay not passed");

        uint256 confidence = (_yesEff() * BPS_DENOM) / _totalEff();

        if (confidence > 5000) {
            settledYesWins = true;
            isTie          = false;
        } else if (confidence < 5000) {
            settledYesWins = false;
            isTie          = false;
        } else {
            isTie          = true;
            settledYesWins = false;
        }

        status = STATUS_SETTLED;
        emit MarketSettled(settledYesWins, isTie);
    }

    /// @notice Claim reward after settlement.
    function claim() external nonReentrant {
        require(status == STATUS_SETTLED, "Not settled");
        require(!claimed[msg.sender], "Already claimed");
        uint256 amount = getClaimAmount(msg.sender);
        require(amount > 0, "Nothing to claim");
        claimed[msg.sender] = true;
        uint256 yesBal = balanceOf(msg.sender, YES);
        uint256 noBal  = balanceOf(msg.sender, NO);
        if (yesBal > 0) _burn(msg.sender, YES, yesBal);
        if (noBal  > 0) _burn(msg.sender, NO,  noBal);
        IERC20(usdt).safeTransfer(msg.sender, amount);
        emit Claimed(msg.sender, amount);
    }
}
