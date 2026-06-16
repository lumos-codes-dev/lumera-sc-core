# 🚀 Lumera SC Core

[![CI/CD](https://github.com/lumos-codes-dev/lumera-sc-core/actions/workflows/ci.yml/badge.svg)](https://github.com/lumos-codes-dev/lumera-sc-core/actions/workflows/ci.yml)

Smart contract core for the Lumera protocol — governance token, staking, vesting, and DAO.

## 📋 Table of Contents

- [🔍 Overview](#-overview)
- [🏗️ Architecture](#️-architecture)
- [⚙️ Setup](#️-setup)
- [🚀 Deployment](#-deployment)
- [📍 Deployed Contracts](#-deployed-contracts)
- [📄 Contract ABIs](#-contract-abis)
- [🧪 Testing](#-testing)
- [📊 Coverage](#-coverage)
- [📋 Contracts](#-contracts)
  - [LURToken](#lurtoken)
  - [LURStaking](#lurstaking)
  - [LURVesting](#lurvesting)
  - [LURDAO](#lurdao)
  - [TimeLock](#timelock)

---

## 🔍 Overview

Lumera SC Core is the on-chain foundation of the Lumera protocol. It provides a governance token (LUR), a multi-pool staking system with time-lock and APR-based rewards, a flexible vesting system with cliff and period schedules, and a full on-chain DAO backed by a timelock controller.

All contracts are written in Solidity 0.8.28 and built on top of OpenZeppelin v5. The staking contract is upgradeable via the UUPS proxy pattern.

### Key Features

- **Governance token**: ERC20 with on-chain voting power (`ERC20Votes`) and gasless approvals (`ERC20Permit`)
- **Multi-pool staking**: Configurable lock durations and APR per pool, with per-user reward tracking
- **Force unstake**: Users can exit before lock expiry at the cost of forfeiting rewards
- **Vesting schedules**: Manager creates pool rules, then allocates tokens per-user (single or batch). Cliff + periodic unlock with optional immediate unlock percentage, per-pool claim pause
- **On-chain DAO**: Governor with quorum, proposal threshold, voting delay/period, and timelock execution
- **Emergency controls**: Global pause and per-pool staking/unstaking pause

---

## 🏗️ Architecture

```
lumera-sc-core
├── LURToken.sol               ERC20 + ERC20Votes + ERC20Permit
│
├── LURStaking.sol             UUPS upgradeable staking
│   ├── Initializable
│   ├── UUPSUpgradeable
│   ├── ReentrancyGuardUpgradeable
│   └── PausableExtUpgradeable (AccessControl + Pausable + PAUSER_ROLE)
│
├── LURVesting.sol             UUPS upgradeable token vesting
│   ├── Initializable
│   ├── UUPSUpgradeable
│   ├── ReentrancyGuardUpgradeable
│   └── PausableExtUpgradeable (AccessControl + Pausable + PAUSER_ROLE)
│
├── dao/
│   ├── LURDAO.sol             On-chain governor
│   │   ├── Governor
│   │   ├── GovernorSettings
│   │   ├── GovernorCountingSimple
│   │   ├── GovernorVotes
│   │   ├── GovernorVotesQuorumFraction
│   │   └── GovernorTimelockControl
│   └── TimeLock.sol           TimelockController for DAO execution
│
├── core/
│   └── PausableExtUpgradeable.sol
│
└── interfaces/
    ├── ILURStaking.sol
    └── ILURVesting.sol
```

---

## ⚙️ Setup

### Prerequisites

- Node.js v18+
- npm

### Installation

```bash
git clone https://github.com/lumos-codes-dev/lumera-sc-core.git
cd lumera-sc-core
npm install
```

### Environment variables

Create a `.env` file in the root:

```env
PRIVATE_KEY=your_deployer_private_key

SEPOLIA_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
MAINNET_RPC_URL=https://ethereum-rpc.publicnode.com

ETHERSCAN_API_KEY=your_etherscan_api_key

# Optional: override defaults in the deploy script
VESTING_MANAGER=0x...           # address that receives VESTING_MANAGER_ROLE (defaults to deployer)
TEST_VESTING_BENEFICIARY=0x...  # recipient of the test vesting pool (defaults to deployer)
```

### Compile

```bash
npm run compile
```

---

## 🚀 Deployment

```bash
npx hardhat run scripts/deploy/sepolia.ts --network sepolia
```

### Deployment order

1. **LURToken** — minted to deployer
2. **TimeLock** — deployer as temporary admin
3. **LURDAO** — wired to LURToken (votes) and TimeLock
4. **LURVesting** — DAO as admin, `VESTING_MANAGER` as operator
5. **LURStaking** — UUPS proxy, deployer as admin
6. TimeLock `PROPOSER_ROLE` + `EXECUTOR_ROLE` granted to DAO
7. Three staking pools created; staking contract funded with reward reserves
8. Test vesting pool created (1 token/second, 1 000 s total)
9. All contracts verified on Etherscan

### Staking pools (Sepolia)

| Pool             | Lock     | APR  |
| ---------------- | -------- | ---- |
| LUR 1-Month Lock | 30 days  | 75%  |
| LUR 6-Month Lock | 180 days | 100% |
| LUR 1-Year Lock  | 365 days | 125% |

### Post-deployment (production)

After governance is fully operational, revoke the deployer's `DEFAULT_ADMIN_ROLE` on TimeLock:

```ts
await timeLock.renounceRole(
  await timeLock.DEFAULT_ADMIN_ROLE(),
  deployerAddress
);
```

---

## 📍 Deployed Contracts

### Sepolia (Chain ID: 11155111)

| Contract           | Address                                      | Explorer                                                                                |
| ------------------ | -------------------------------------------- | --------------------------------------------------------------------------------------- |
| LURToken           | `0xD1E4E8067fFAacc787342342884c53a10D2877E9` | [View](https://sepolia.etherscan.io/address/0xD1E4E8067fFAacc787342342884c53a10D2877E9) |
| TimeLock           | `0x88EFaa1798905F37eE5A8FFE7Fe2139284b6A9e8` | [View](https://sepolia.etherscan.io/address/0x88EFaa1798905F37eE5A8FFE7Fe2139284b6A9e8) |
| LURDAO             | `0x4B8563F7A61dcAc36D1315C978BCF3FF59d6D398` | [View](https://sepolia.etherscan.io/address/0x4B8563F7A61dcAc36D1315C978BCF3FF59d6D398) |
| LURVesting (proxy) | `0x5258354A32324BDee0b6f1232Ee03Ba7Bb1f64f4` | [View](https://sepolia.etherscan.io/address/0x5258354A32324BDee0b6f1232Ee03Ba7Bb1f64f4) |
| LURVesting (impl)  | `0x4A0a45C8E45a66fe21FD69422644210523C93977` | [View](https://sepolia.etherscan.io/address/0x4A0a45C8E45a66fe21FD69422644210523C93977) |
| LURStaking (proxy) | `0xB99a627e78C96aa323496eF250E6ca87B13c65a5` | [View](https://sepolia.etherscan.io/address/0xB99a627e78C96aa323496eF250E6ca87B13c65a5) |
| LURStaking (impl)  | `0x18913a44C974cbF17A3231E87FF88ea6dE4b21B3` | [View](https://sepolia.etherscan.io/address/0x18913a44C974cbF17A3231E87FF88ea6dE4b21B3) |

---

## 📄 Contract ABIs

ABI files for all contracts are located in the [`abi/`](./abi) directory.

| Contract   | File                                           |
| ---------- | ---------------------------------------------- |
| LURToken   | [`abi/LURToken.json`](./abi/LURToken.json)     |
| LURStaking | [`abi/LURStaking.json`](./abi/LURStaking.json) |
| LURVesting | [`abi/LURVesting.json`](./abi/LURVesting.json) |
| LURDAO     | [`abi/LURDAO.json`](./abi/LURDAO.json)         |
| TimeLock   | [`abi/TimeLock.json`](./abi/TimeLock.json)     |

> **LURStaking** — interact via the **proxy address**, not the implementation. The ABI is the same regardless of which implementation is deployed.

### Quick start (ethers.js)

```ts
import { ethers } from "ethers";
import LURTokenABI from "./abi/LURToken.json";
import LURStakingABI from "./abi/LURStaking.json";
import LURVestingABI from "./abi/LURVesting.json";
import LURDAOABI from "./abi/LURDAO.json";
import TimeLockABI from "./abi/TimeLock.json";

const provider = new ethers.BrowserProvider(window.ethereum);
const signer = await provider.getSigner();

const lurToken = new ethers.Contract(LUR_TOKEN_ADDRESS, LURTokenABI, signer);
const staking = new ethers.Contract(LUR_STAKING_PROXY, LURStakingABI, signer);
const vesting = new ethers.Contract(LUR_VESTING_ADDRESS, LURVestingABI, signer);
const dao = new ethers.Contract(LUR_DAO_ADDRESS, LURDAOABI, signer);
const timeLock = new ethers.Contract(TIME_LOCK_ADDRESS, TimeLockABI, signer);
```

---

## 🧪 Testing

```bash
npm run test
```

```bash
npx hardhat test test/LURToken.test.ts
npx hardhat test test/LURStaking.test.ts
npx hardhat test test/LURVesting.test.ts
npx hardhat test test/LURDAO.test.ts
```

---

## 📊 Coverage

```bash
npm run coverage
```

Reports are generated in `coverage/`:

- `coverage/index.html` — HTML report
- `coverage/lcov-report/index.html` — LCOV report
- `coverage/coverage-final.json` — JSON data

---

## 📋 Contracts

### Frontend integration notes

> **Token amounts** — all amount values (`uint256`) are in the token's smallest unit (18 decimals). Use `ethers.formatUnits(value, 18)` to display and `ethers.parseUnits(amount, 18)` to send.
>
> **Timestamps** — all timestamp values (`uint256`) are Unix seconds. Multiply by 1 000 to get a JS `Date` (`new Date(Number(lockUntil) * 1000)`).
>
> **APR (basis points)** — APR values use BPS where `10 000 = 100%`. To display: `apr / 100`. Example: `7500 → 75%`.
>
> **LURStaking proxy** — always interact via the **proxy address**, never the implementation address directly.
>
> **Approvals** — `stake()`, `allocate()`, and `allocateBatch()` pull tokens from the caller. You must call `lurToken.approve(contractAddress, amount)` first.

---

### LURToken

Standard ERC20 with on-chain voting power and gasless permit approvals. Fixed supply minted to `initialOwner` at construction.

#### TypeScript interface

```ts
interface LURToken {
  // ── ERC20 standard ────────────────────────────────────────────────────────
  name(): Promise<string>;
  symbol(): Promise<string>;
  decimals(): Promise<number>; // always 18
  totalSupply(): Promise<bigint>; // wei
  balanceOf(account: string): Promise<bigint>; // wei
  allowance(owner: string, spender: string): Promise<bigint>; // wei
  approve(
    spender: string,
    amount: bigint
  ): Promise<ContractTransactionResponse>;
  transfer(to: string, amount: bigint): Promise<ContractTransactionResponse>;
  transferFrom(
    from: string,
    to: string,
    amount: bigint
  ): Promise<ContractTransactionResponse>;

  // ── ERC20Votes ────────────────────────────────────────────────────────────
  // Users must delegate to themselves (or anyone) before their balance counts as voting power.
  delegate(delegatee: string): Promise<ContractTransactionResponse>;
  delegates(account: string): Promise<string>; // current delegatee
  getVotes(account: string): Promise<bigint>; // current voting power, wei
  getPastVotes(account: string, timepoint: bigint): Promise<bigint>; // voting power at timestamp

  // ── ERC20Permit ───────────────────────────────────────────────────────────
  nonces(owner: string): Promise<bigint>;
  permit(
    owner: string,
    spender: string,
    value: bigint,
    deadline: bigint,
    v: number,
    r: string,
    s: string
  ): Promise<ContractTransactionResponse>;

  // ── Clock ─────────────────────────────────────────────────────────────────
  clock(): Promise<number>; // current block.timestamp as uint48
  CLOCK_MODE(): Promise<string>; // "mode=timestamp"
}
```

#### Events

| Signature                                                                         | Indexed params     | Description                              |
| --------------------------------------------------------------------------------- | ------------------ | ---------------------------------------- |
| `Transfer(address from, address to, uint256 value)`                               | `from`, `to`       | Any token transfer including mints/burns |
| `Approval(address owner, address spender, uint256 value)`                         | `owner`, `spender` | Approval changed                         |
| `DelegateChanged(address delegator, address fromDelegate, address toDelegate)`    | `delegator`        | Voting delegation changed                |
| `DelegateVotesChanged(address delegate, uint256 previousVotes, uint256 newVotes)` | `delegate`         | Voting power checkpoint recorded         |

---

### LURStaking

UUPS-upgradeable multi-pool staking. Rewards are paid in the same token as the staked token and are calculated as:

```
reward = stakedAmount × (apr / 10000) × (lockDuration / 365days)
```

Rewards are distributed on `unstake()`. The contract must hold enough tokens to cover all pending rewards — fund it after deployment.

#### Roles

| Role constant        | `keccak256` value              | Who can call                              |
| -------------------- | ------------------------------ | ----------------------------------------- |
| `DEFAULT_ADMIN_ROLE` | `0x00…00` (bytes32 zero)       | Create pools, manage roles, upgrade proxy |
| `PAUSER_ROLE`        | `keccak256("PAUSER_ROLE")`     | `pause()` / `unpause()`                   |
| `WITHDRAWER_ROLE`    | `keccak256("WITHDRAWER_ROLE")` | `refund()`                                |

#### TypeScript interface

```ts
// ── Structs ────────────────────────────────────────────────────────────────────

interface Pool {
  name: string; // pool display name
  token: string; // ERC20 token address
  apr: number; // reward rate in BPS (7500 = 75%)
  lockDuration: number; // lock duration in seconds (e.g. 2592000 = 30 days)
  minStakeAmount: bigint; // minimum stake in wei
  maxStakeAmount: bigint; // maximum stake in wei
  stakingPaused: boolean;
  unstakingPaused: boolean;
  totalStaked: bigint; // total currently staked in wei
}

interface UserPoolExtended extends Pool {
  id: bigint; // pool index (0-based)
  stakedByUser: bigint; // user's staked balance in wei
  stakedByUserAt: number; // Unix timestamp when the user last staked (0 if never)
  lockedUntilForUser: number; // Unix timestamp when the user's lock expires (0 if never staked)
  pendingRewards: bigint; // rewards the user will receive on unstake, in wei
  isTokensLocked: boolean; // true if block.timestamp < lockedUntilForUser
}

interface CreatePoolParams {
  name: string;
  token: string; // ERC20 address
  apr: number; // BPS (10000 = 100%)
  lockDuration: number; // seconds
  minStakeAmount: bigint; // wei
  maxStakeAmount: bigint; // wei
}

// ── Contract ───────────────────────────────────────────────────────────────────

interface LURStaking {
  // ── View ──────────────────────────────────────────────────────────────────
  getTotalPools(): Promise<bigint>;
  getPool(poolId: bigint): Promise<Pool>;
  getPools(
    user: string, // pass ethers.ZeroAddress if no user context needed
    offset: bigint,
    limit: bigint
  ): Promise<UserPoolExtended[]>;
  getUserStakeDetails(
    user: string,
    poolId: bigint
  ): Promise<{
    staked: bigint; // wei
    lockUntil: bigint; // Unix timestamp (seconds)
    pendingRewards: bigint; // wei
    isLocked: boolean;
  }>;
  calculateRewards(
    apr: number, // BPS (e.g. 1000 = 10%)
    amount: bigint, // wei
    duration: number // seconds
  ): Promise<bigint>; // expected reward in wei
  // Shorthand overload — looks up pool APR and lockDuration automatically
  calculateRewards(
    poolId: bigint, // pool index
    amount: bigint // wei
  ): Promise<bigint>; // expected reward in wei
  paused(): Promise<boolean>;
  hasRole(role: string, account: string): Promise<boolean>;

  // ── User actions ──────────────────────────────────────────────────────────
  // Requires prior: lurToken.approve(stakingAddress, amount)
  stake(poolId: bigint, amount: bigint): Promise<ContractTransactionResponse>;
  unstake(poolId: bigint, force: boolean): Promise<ContractTransactionResponse>;

  // ── Admin ─────────────────────────────────────────────────────────────────
  createPool(params: CreatePoolParams): Promise<ContractTransactionResponse>;
  setStakingPaused(
    poolId: bigint,
    paused: boolean
  ): Promise<ContractTransactionResponse>;
  setUnstakingPaused(
    poolId: bigint,
    paused: boolean
  ): Promise<ContractTransactionResponse>;
  pause(): Promise<ContractTransactionResponse>;
  unpause(): Promise<ContractTransactionResponse>;
  refund(
    token: string,
    to: string,
    amount: bigint
  ): Promise<ContractTransactionResponse>;
  // token = ethers.ZeroAddress to refund ETH
}
```

#### Usage examples

```ts
import { ethers } from "ethers";

const staking = new ethers.Contract(STAKING_ADDRESS, STAKING_ABI, signer);
const token = new ethers.Contract(TOKEN_ADDRESS, ERC20_ABI, signer);

// List all pools for the connected user (paginated)
const pools = await staking.getPools(userAddress, 0n, 10n);
// pools[0].apr / 100  → displayed APR %
// ethers.formatUnits(pools[0].minStakeAmount, 18)  → minimum stake in LUR

// Stake 100 LUR in pool 0
const amount = ethers.parseUnits("100", 18);
await token.approve(STAKING_ADDRESS, amount);
await staking.stake(0n, amount);

// Unstake normally (after lock expires)
await staking.unstake(0n, false);

// Force unstake before lock expires (forfeits rewards)
await staking.unstake(0n, true);

// Get a specific user's live stake details
const { staked, lockUntil, pendingRewards, isLocked } =
  await staking.getUserStakeDetails(userAddress, 0n);
const lockDate = new Date(Number(lockUntil) * 1000);

// Estimate rewards before staking — shorthand (UI preview, requires only poolId + amount)
const estimated = await staking["calculateRewards(uint256,uint256)"](
  0n,
  ethers.parseUnits("100", 18)
);
console.log("Expected reward:", ethers.formatUnits(estimated, 18), "LUR");

// Alternative: pass APR + duration explicitly (no on-chain call needed for pool data)
const pool = await staking.getPool(0n);
const estimatedManual = await staking[
  "calculateRewards(uint32,uint256,uint32)"
](pool.apr, ethers.parseUnits("100", 18), pool.lockDuration);
```

#### Events

| Signature                                                                                                 | Indexed                   | Description                                                     |
| --------------------------------------------------------------------------------------------------------- | ------------------------- | --------------------------------------------------------------- |
| `PoolCreated(uint256 poolId, address token)`                                                              | `poolId`, `token`         | New pool created                                                |
| `Staked(address user, uint256 poolId, address token, uint256 amount, uint256 lockUntil, uint256 rewards)` | `user`, `poolId`, `token` | Tokens staked; `rewards` is the projected reward at lock expiry |
| `Unstaked(address user, uint256 poolId, address token, uint256 amount, uint256 rewards, bool forced)`     | `user`, `poolId`, `token` | Tokens unstaked; `rewards = 0` when `forced = true`             |
| `StakingPausedUpdated(uint256 poolId, bool paused)`                                                       | `poolId`, `paused`        | Per-pool staking pause toggled                                  |
| `UnstakingPausedUpdated(uint256 poolId, bool paused)`                                                     | `poolId`, `paused`        | Per-pool unstaking pause toggled                                |
| `Refund(address token, address to, uint256 amount)`                                                       | `token`, `to`, `amount`   | Admin withdrawal                                                |
| `Paused(address account)` / `Unpaused(address account)`                                                   | `account`                 | Global pause state changed                                      |

#### Errors

| Error                                                  | Thrown when                                                     |
| ------------------------------------------------------ | --------------------------------------------------------------- |
| `LURStaking__ZeroAddress`                              | A required address argument is `address(0)`                     |
| `LURStaking__InvalidName`                              | Pool name is empty or longer than 64 characters                 |
| `LURStaking__ZeroAmount`                               | Amount argument is `0`                                          |
| `LURStaking__InvalidAmounts`                           | `minStakeAmount > maxStakeAmount`                               |
| `LURStaking__PoolNotExists`                            | `poolId >= totalPools`                                          |
| `LURStaking__StakingPaused`                            | Pool staking is paused (or global pause is on)                  |
| `LURStaking__UnstakingPaused`                          | Pool unstaking is paused (or global pause is on)                |
| `LURStaking__AmountTooLow`                             | `userStake + amount < minStakeAmount`                           |
| `LURStaking__AmountTooHigh`                            | `userStake + amount > maxStakeAmount`                           |
| `LURStaking__TokensLocked`                             | Non-forced unstake called before `lockUntil`                    |
| `LURStaking__WithdrawAmountExceedsWithdrawableBalance` | `refund()` would reduce balance below staked + reserved rewards |
| `LURStaking__TransferFailed`                           | ETH transfer in `refund()` failed                               |

---

### LURVesting

UUPS-upgradeable token vesting contract. A manager creates reusable **pool rules** (cliff, period schedule, initial unlock %) via `createPool`, then allocates tokens per-user via `allocate` or `allocateBatch`. Each user claims independently from each pool they have an allocation in.

**Unlock formula:**

```
cliffEnd = start + cliffDuration

// Before cliff end: 0 tokens claimable
// After cliff end:
  passedPeriods  = floor((now - start - cliffDuration) / periodDuration)
  initialAmount  = totalAmount × (initialUnlockPercent / 10000)

  if passedPeriods >= periodCount:
    unlocked = totalAmount
  else:
    unlocked = ((totalAmount - initialAmount) × passedPeriods / periodCount) + initialAmount

claimable = unlocked - alreadyClaimed
```

#### Roles

| Role constant        | `keccak256` value          | Who can call                              |
| -------------------- | -------------------------- | ----------------------------------------- |
| `DEFAULT_ADMIN_ROLE` | `0x00…00` (bytes32 zero)   | Manage roles, upgrade proxy               |
| `MANAGER_ROLE`       | `keccak256("MANAGER_ROLE")`| `createPool`, `allocate`, `allocateBatch`, `refund` |
| `PAUSER_ROLE`        | `keccak256("PAUSER_ROLE")` | `setClaimPaused`, `pause`, `unpause`      |

#### TypeScript interface

```ts
// ── Structs ────────────────────────────────────────────────────────────────────

interface Pool {
  name: string;
  cliffDuration: bigint;      // seconds before any tokens unlock
  periodDuration: bigint;     // seconds per unlock period
  periodCount: bigint;        // total number of unlock periods
  initialUnlockPercent: bigint; // BPS (e.g. 1000 = 10% unlocked right after cliff)
  claimPaused: boolean;
}

interface UserAllocation {
  total: bigint;    // total tokens allocated, wei
  claimed: bigint;  // tokens already claimed, wei
  start: bigint;    // Unix timestamp when vesting starts
}

interface UserPoolExtended extends Pool {
  id: bigint;
  allocatedForUser: bigint;   // total tokens allocated to the user in this pool
  claimedByUser: bigint;      // tokens already claimed
  startForUser: bigint;       // vesting start timestamp for the user (0 if not allocated)
  claimableForUser: bigint;   // tokens claimable right now
}

interface CreatePoolParams {
  name: string;
  cliffDuration: bigint;
  periodDuration: bigint;
  periodCount: bigint;
  initialUnlockPercent: bigint; // BPS 0–10000
}

interface AllocateParams {
  recipient: string;
  amount: bigint;   // wei; caller must approve this amount
  start: bigint;    // Unix timestamp; pass 0 to use block.timestamp
}

// ── Contract ───────────────────────────────────────────────────────────────────

interface LURVesting {
  // ── View ──────────────────────────────────────────────────────────────────
  getTotalPools(): Promise<bigint>;
  getPool(poolId: bigint): Promise<Pool>;
  getPools(
    user: string,   // pass ethers.ZeroAddress if no user context needed
    offset: bigint,
    limit: bigint
  ): Promise<UserPoolExtended[]>;
  getUserAllocation(user: string, poolId: bigint): Promise<UserAllocation>;
  getClaimableAmount(user: string, poolId: bigint): Promise<bigint>;
  paused(): Promise<boolean>;
  hasRole(role: string, account: string): Promise<boolean>;

  // ── User actions ──────────────────────────────────────────────────────────
  claim(poolId: bigint): Promise<ContractTransactionResponse>;

  // ── Manager ───────────────────────────────────────────────────────────────
  createPool(params: CreatePoolParams): Promise<ContractTransactionResponse>;

  // Single allocation — requires: lurToken.approve(vestingAddress, amount)
  allocate(
    poolId: bigint,
    recipient: string,
    amount: bigint,
    start: bigint   // 0 = block.timestamp
  ): Promise<ContractTransactionResponse>;

  // Batch allocation — requires: lurToken.approve(vestingAddress, totalAmount)
  allocateBatch(
    poolId: bigint,
    entries: AllocateParams[]  // max 100 entries
  ): Promise<ContractTransactionResponse>;

  setClaimPaused(poolId: bigint, paused: boolean): Promise<ContractTransactionResponse>;
  refund(
    tokenAddress: string,
    recipient: string,
    amount: bigint
  ): Promise<ContractTransactionResponse>;
}
```

#### Usage examples

```ts
import { ethers } from "ethers";

const vesting = new ethers.Contract(VESTING_ADDRESS, VESTING_ABI, signer);
const token = new ethers.Contract(TOKEN_ADDRESS, ERC20_ABI, signer);

// ── Manager: create a pool ────────────────────────────────────────────────────
await vesting.createPool({
  name: "Team",
  cliffDuration: BigInt(6 * 30 * 24 * 3600), // 6-month cliff
  periodDuration: BigInt(30 * 24 * 3600),     // monthly periods
  periodCount: 24n,                            // 2-year linear unlock
  initialUnlockPercent: 0n,
});
// pool 0 is now created

// ── Manager: allocate to a single user ───────────────────────────────────────
const amount = ethers.parseUnits("1000", 18);
await token.approve(VESTING_ADDRESS, amount);
await vesting.allocate(0n, "0xRecipient...", amount, 0n); // start = now

// ── Manager: allocate to multiple users in one tx ─────────────────────────────
const entries = [
  { recipient: "0xAlice...", amount: ethers.parseUnits("500", 18), start: 0n },
  { recipient: "0xBob...",   amount: ethers.parseUnits("300", 18), start: 0n },
  { recipient: "0xCarol...", amount: ethers.parseUnits("200", 18), start: 0n },
];
const totalAmount = entries.reduce((s, e) => s + e.amount, 0n);
await token.approve(VESTING_ADDRESS, totalAmount);
await vesting.allocateBatch(0n, entries);

// ── User: check and claim ─────────────────────────────────────────────────────
const claimable = await vesting.getClaimableAmount(userAddress, 0n);
console.log(ethers.formatUnits(claimable, 18), "LUR claimable from pool 0");

await vesting.claim(0n);

// ── Read allocation details ───────────────────────────────────────────────────
const alloc = await vesting.getUserAllocation(userAddress, 0n);
// alloc.total, alloc.claimed, alloc.start

// ── List all pools with user context (paginated) ──────────────────────────────
const pools = await vesting.getPools(userAddress, 0n, 10n);
// pools[0].claimableForUser, pools[0].allocatedForUser, etc.
```

#### Events

| Signature                                                                    | Indexed              | Description                         |
| ---------------------------------------------------------------------------- | -------------------- | ------------------------------------ |
| `PoolCreated(uint256 poolId, string name, uint256 cliffDuration, uint256 periodDuration, uint256 periodCount, uint256 initialUnlockPercent)` | `poolId` | New pool rules created |
| `Allocated(uint256 poolId, address recipient, uint256 amount, uint256 start)` | `poolId`, `recipient` | Tokens allocated to a recipient     |
| `Claim(address recipient, uint256 poolId, uint256 amount)`                   | `recipient`, `poolId`| Tokens claimed                       |
| `Refund(address token, address recipient, uint256 amount)`                   | `token`, `recipient` | Manager withdrawal                   |

#### Errors

| Error                                                               | Thrown when                                                                                 |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `LURVesting__ZeroAddress`                                           | A required address argument is `address(0)`                                                 |
| `LURVesting__ZeroAmount`                                            | `amount`, `periodDuration`, or `periodCount` is `0`                                         |
| `LURVesting__InvalidName`                                           | Pool name is empty or longer than 64 characters                                             |
| `LURVesting__InitialUnlockExceedsLimit`                             | `initialUnlockPercent > 10000`                                                              |
| `LURVesting__PoolNotExists`                                         | `poolId >= totalPools`                                                                      |
| `LURVesting__AlreadyAllocated`                                      | Recipient already has an allocation in this pool                                            |
| `LURVesting__InvalidBatchSize`                                      | Batch array is empty or has more than 100 entries                                           |
| `LURVesting__NoAllocationsFound`                                    | `claim()` called for a pool where the caller has no allocation                              |
| `LURVesting__ClaimPaused`                                           | Claiming is paused for this pool                                                            |
| `LURVesting__NotEnoughBalance(uint256 available, uint256 required)` | `refund()` amount exceeds withdrawable balance                                              |

---

### LURDAO

On-chain governor. Uses LURToken voting power (checkpointed by timestamp). Proposals are queued through TimeLock before execution, enforcing a mandatory delay.

> **Voting power**: a user's balance only counts as voting power after they call `lurToken.delegate(userAddress)` (self-delegate). Always prompt users to delegate before voting.

#### Constructor parameters

| Parameter            | Solidity type        | Description                                             |
| -------------------- | -------------------- | ------------------------------------------------------- |
| `_token`             | `IVotes`             | LURToken address                                        |
| `_timelock`          | `TimelockController` | TimeLock address                                        |
| `_votingDelay`       | `uint48`             | Seconds after proposal creation before voting opens     |
| `_votingPeriod`      | `uint32`             | Seconds the voting window is open                       |
| `_proposalThreshold` | `uint256`            | Minimum LUR balance (wei) required to create a proposal |
| `_quorumPercentage`  | `uint256`            | % of total supply required for quorum (e.g. `1` = 1%)   |

#### Key inherited functions (OpenZeppelin Governor)

```ts
interface LURDAO {
  // ── Proposal lifecycle ────────────────────────────────────────────────────
  propose(
    targets: string[], // contract addresses to call
    values: bigint[], // ETH to send with each call (wei)
    calldatas: string[], // encoded function calls (use iface.encodeFunctionData)
    description: string // human-readable description; hash is used as ID salt
  ): Promise<ContractTransactionResponse>; // returns proposalId in receipt

  queue(
    targets: string[],
    values: bigint[],
    calldatas: string[],
    descriptionHash: string // keccak256 of the description string
  ): Promise<ContractTransactionResponse>;

  execute(
    targets: string[],
    values: bigint[],
    calldatas: string[],
    descriptionHash: string
  ): Promise<ContractTransactionResponse>;

  cancel(
    targets: string[],
    values: bigint[],
    calldatas: string[],
    descriptionHash: string
  ): Promise<ContractTransactionResponse>;

  // ── Voting ────────────────────────────────────────────────────────────────
  castVote(
    proposalId: bigint,
    support: 0 | 1 | 2
  ): Promise<ContractTransactionResponse>;
  // support: 0 = Against, 1 = For, 2 = Abstain

  // ── View ──────────────────────────────────────────────────────────────────
  state(proposalId: bigint): Promise<number>;
  // 0=Pending, 1=Active, 2=Canceled, 3=Defeated, 4=Succeeded,
  // 5=Queued, 6=Expired, 7=Executed
  proposalSnapshot(proposalId: bigint): Promise<bigint>; // voting-start timestamp
  proposalDeadline(proposalId: bigint): Promise<bigint>; // voting-end timestamp
  proposalEta(proposalId: bigint): Promise<bigint>; // earliest execution timestamp
  getVotes(account: string, timepoint: bigint): Promise<bigint>; // voting power at timepoint
  quorum(timepoint: bigint): Promise<bigint>; // required votes at timepoint, wei
  votingDelay(): Promise<bigint>;
  votingPeriod(): Promise<bigint>;
  proposalThreshold(): Promise<bigint>; // wei
}
```

---

### TimeLock

Thin wrapper around OpenZeppelin `TimelockController`. Queued operations cannot execute until `minDelay` seconds have passed.

#### Constructor parameters

| Parameter   | Solidity type | Description                                                               |
| ----------- | ------------- | ------------------------------------------------------------------------- |
| `minDelay`  | `uint256`     | Minimum seconds between `queue` and `execute`                             |
| `proposers` | `address[]`   | Addresses granted `PROPOSER_ROLE` at construction                         |
| `executors` | `address[]`   | Addresses granted `EXECUTOR_ROLE` at construction                         |
| `admin`     | `address`     | Initial admin (`address(0)` to skip); should be renounced post-deployment |

> **Roles** on TimeLock are managed by `DEFAULT_ADMIN_ROLE`. After the DAO is live, the deployer's admin role should be renounced so that only governance can change TimeLock parameters.
