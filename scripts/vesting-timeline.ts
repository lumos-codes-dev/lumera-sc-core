/**
 * Vesting timeline calculator — fetches real data from LURVesting via RPC
 * Usage: npx ts-node scripts/vesting-timeline.ts <userAddress>
 *
 * Contract: 0x5258354a32324bdee0b6f1232ee03ba7bb1f64f4 (Sepolia)
 * RPC:      SEPOLIA_RPC_URL env var, or public fallback
 */

import { ethers } from "ethers";
import VESTING_ABI from "../abi/LURVesting.json";
import dotenv from "dotenv";
dotenv.config();

const VESTING_ADDRESS = "0x5258354a32324bdee0b6f1232ee03ba7bb1f64f4";
const RPC_URL = process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";
const PAGE_SIZE = 50;

const BASIS_POINTS_DENOMINATOR = 10_000n;

interface Pool {
  cliffDuration: bigint;
  periodDuration: bigint;
  periodCount: bigint;
  initialUnlockPercent: bigint;
}

interface UserAllocation {
  total: bigint;
  claimed: bigint;
  start: bigint;
}

function calculateUnlocked(pool: Pool, alloc: UserAllocation, timestamp: bigint): bigint {
  const cliffEnd = alloc.start + pool.cliffDuration;
  if (timestamp < cliffEnd) return 0n;

  const initialAmount = (alloc.total * pool.initialUnlockPercent) / BASIS_POINTS_DENOMINATOR;
  const passedPeriods = (timestamp - alloc.start - pool.cliffDuration) / pool.periodDuration;

  if (passedPeriods >= pool.periodCount) return alloc.total;
  return ((alloc.total - initialAmount) * passedPeriods) / pool.periodCount + initialAmount;
}

function fullTimeline(
  pool: Pool,
  alloc: UserAllocation
): { timestamp: bigint; totalUnlocked: bigint; delta: bigint }[] {
  const points: { timestamp: bigint; totalUnlocked: bigint; delta: bigint }[] = [];
  let prev = 0n;

  for (let i = 0n; i <= pool.periodCount; i++) {
    const ts = alloc.start + pool.cliffDuration + i * pool.periodDuration;
    const unlocked = calculateUnlocked(pool, alloc, ts);
    points.push({ timestamp: ts, totalUnlocked: unlocked, delta: unlocked - prev });
    prev = unlocked;
    if (unlocked >= alloc.total) break;
  }

  return points;
}

function nextUnlock(pool: Pool, alloc: UserAllocation, now: bigint): { timestamp: bigint; amount: bigint } | null {
  const cliffEnd = alloc.start + pool.cliffDuration;
  const initialAmount = (alloc.total * pool.initialUnlockPercent) / BASIS_POINTS_DENOMINATOR;

  if (now < cliffEnd) {
    return { timestamp: cliffEnd, amount: initialAmount };
  }

  const passedPeriods = (now - alloc.start - pool.cliffDuration) / pool.periodDuration;
  if (passedPeriods >= pool.periodCount) return null;

  const nextPeriod = passedPeriods + 1n;
  const nextTs = alloc.start + pool.cliffDuration + nextPeriod * pool.periodDuration;
  const currentUnlocked = calculateUnlocked(pool, alloc, now);
  const nextUnlocked = ((alloc.total - initialAmount) * nextPeriod) / pool.periodCount + initialAmount;

  return { timestamp: nextTs, amount: nextUnlocked - currentUnlocked };
}

function fmtDate(ts: bigint): string {
  return new Date(Number(ts) * 1000).toISOString().slice(0, 10);
}

function fmtTokens(wei: bigint, decimals = 18): string {
  const whole = wei / 10n ** BigInt(decimals);
  return whole.toLocaleString();
}

const DAY = 86_400n;

async function main() {
  const userAddress = process.argv[2];
  if (!userAddress || !ethers.isAddress(userAddress)) {
    console.error("Usage: npx ts-node scripts/vesting-timeline.ts <userAddress>");
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const vesting = new ethers.Contract(VESTING_ADDRESS, VESTING_ABI, provider);

  console.log(`Contract: ${VESTING_ADDRESS}`);
  console.log(`User:     ${userAddress}`);
  console.log(`RPC:      ${RPC_URL}\n`);

  const totalPools: bigint = await vesting.getTotalPools();
  if (totalPools === 0n) {
    console.log("No pools found.");
    return;
  }

  const raw = await vesting.getPools(userAddress, 0, totalPools < BigInt(PAGE_SIZE) ? totalPools : BigInt(PAGE_SIZE));

  const NOW = BigInt(Math.floor(Date.now() / 1000));
  let printedAny = false;

  for (const entry of raw) {
    const pool: Pool = {
      cliffDuration: entry.cliffDuration,
      periodDuration: entry.periodDuration,
      periodCount: entry.periodCount,
      initialUnlockPercent: entry.initialUnlockPercent,
    };
    const alloc: UserAllocation = {
      total: entry.allocatedForUser,
      claimed: entry.claimedByUser,
      start: entry.startForUser,
    };

    if (alloc.total === 0n) continue;
    printedAny = true;

    const totalDurationDays = (pool.cliffDuration + pool.periodCount * pool.periodDuration) / DAY;
    const vestingEnd = alloc.start + pool.cliffDuration + pool.periodCount * pool.periodDuration;
    const unlocked = calculateUnlocked(pool, alloc, NOW);
    const claimable = unlocked > alloc.claimed ? unlocked - alloc.claimed : 0n;

    console.log(`${"─".repeat(72)}`);
    console.log(`POOL #${entry.id}: ${entry.name}`);
    console.log(`  Start:          ${fmtDate(alloc.start)}`);
    console.log(`  Cliff ends:     ${fmtDate(alloc.start + pool.cliffDuration)}`);
    console.log(`  Vesting ends:   ${fmtDate(vestingEnd)}`);
    console.log(`  Total duration: ${totalDurationDays} days`);
    console.log(`  Allocated:      ${fmtTokens(alloc.total)} tokens`);
    console.log(`  Claimed:        ${fmtTokens(alloc.claimed)} tokens`);
    console.log(`  Now unlocked:   ${fmtTokens(unlocked)} tokens`);
    console.log(`  Now claimable:  ${fmtTokens(claimable)} tokens`);

    const next = nextUnlock(pool, alloc, NOW);
    if (next) {
      console.log(`  Next unlock:    ${fmtDate(next.timestamp)} (+${fmtTokens(next.amount)} tokens)`);
    } else {
      console.log(`  Next unlock:    fully vested`);
    }

    console.log(`\n  Full timeline:`);
    for (const pt of fullTimeline(pool, alloc)) {
      const marker = pt.timestamp <= NOW ? "✓" : "○";
      console.log(
        `    ${marker} ${fmtDate(pt.timestamp)}  total=${fmtTokens(pt.totalUnlocked).padStart(10)}  +${fmtTokens(
          pt.delta
        ).padStart(10)}`
      );
    }
    console.log();
  }

  if (!printedAny) {
    console.log("No allocations found for this address.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
