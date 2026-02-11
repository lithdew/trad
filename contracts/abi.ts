import { parseAbi } from "viem";

/**
 * TradDelegate contract ABI in viem human-readable format.
 *
 * Covers: deposits, withdrawals, operator trading, fee management,
 * ownership, pausability, and all emitted events.
 */
export const tradDelegateAbi = parseAbi([
  // ── Constructor ───────────────────────────────────────────────────
  "constructor(address _feeReceiver, uint256 _fee)",

  // ── Errors (for decoding bubbled-up reverts) ──────────────────────
  // NOTE: These errors may originate from downstream RobinPump pair/token calls.
  "error SlippageExceeded()",

  // ── Ownership ─────────────────────────────────────────────────────
  "function owner() view returns (address)",
  "function transferOwnership(address newOwner)",

  // ── Pausable ──────────────────────────────────────────────────────
  "function paused() view returns (bool)",
  "function pause()",
  "function unpause()",

  // ── Guardian ──────────────────────────────────────────────────────
  "function guardian() view returns (address)",
  "function setGuardian(address newGuardian)",

  // ── Operator ──────────────────────────────────────────────────────
  "function operator() view returns (address)",
  "function setOperator(address newOperator)",

  // ── Pair allowlist ────────────────────────────────────────────────
  "function allowedPairs(address pair) view returns (bool)",
  "function allowedPairCodehashes(bytes32 codehash) view returns (bool)",
  "function isPairAllowed(address pair) view returns (bool)",
  "function setPairAllowed(address pair, bool allowed)",
  "function setPairCodehashAllowed(bytes32 codehash, bool allowed)",

  // ── Fee ───────────────────────────────────────────────────────────
  "function fee() view returns (uint256)",
  "function setFee(uint256 newFee)",
  "function feeReceiver() view returns (address)",
  "function setFeeReceiver(address newFeeReceiver)",

  // ── Deposits & Balances ───────────────────────────────────────────
  "function deposit() payable",
  "function balanceOf(address user) view returns (uint256)",
  "function tokenBalanceOf(address user, address token) view returns (uint256)",

  // ── Withdrawals ───────────────────────────────────────────────────
  "function withdraw(uint256 amount)",
  "function withdrawAll()",
  "function withdrawTokens(address token, uint256 amount)",

  // ── Trading ───────────────────────────────────────────────────────
  "function executeBuy(address user, address pair, uint256 ethAmount, uint256 minTokensOut, uint256 deadline)",
  "function executeSell(address user, address pair, uint256 tokenAmount, uint256 minEthOut, uint256 deadline)",

  // ── Events ────────────────────────────────────────────────────────
  "event Deposit(address indexed user, uint256 amount)",
  "event Withdraw(address indexed user, uint256 amount)",
  "event TokenWithdraw(address indexed user, address indexed token, uint256 amount)",
  "event OperatorChanged(address indexed previousOperator, address indexed newOperator)",
  "event FeeChanged(uint256 previousFee, uint256 newFee)",
  "event FeeReceiverChanged(address indexed previousReceiver, address indexed newReceiver)",
  "event GuardianChanged(address indexed previousGuardian, address indexed newGuardian)",
  "event PairAllowed(address indexed pair, bool allowed)",
  "event PairCodehashAllowed(bytes32 indexed codehash, bool allowed)",
  "event BuyExecuted(address indexed user, address indexed pair, uint256 ethSpent, uint256 tokensReceived, uint256 feeTaken)",
  "event SellExecuted(address indexed user, address indexed pair, uint256 tokensSold, uint256 ethReceived, uint256 feeTaken)",
  "event Paused(address account)",
  "event Unpaused(address account)",
  "event OwnershipTransferred(address indexed previousOwner, address indexed newOwner)",
]);
