import { ethers, upgrades } from "hardhat";
import hre from "hardhat";

const LUR_TOKEN_ADDRESS = "0xD1E4E8067fFAacc787342342884c53a10D2877E9";
const DAO_ADDRESS = "0x4B8563F7A61dcAc36D1315C978BCF3FF59d6D398";

const EXTRA_RECIPIENT = "0x224637236f8C7c8ec3E8bbAe7b77F75d48074043";
const ALLOCATION_AMOUNT = ethers.parseEther("1000000");

const SECOND = 1;
const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

const VESTING_POOLS = [
  {
    name: "Team Allocation",
    cliffDuration: HOUR, // 1-hour cliff
    periodDuration: MINUTE, // 1-minute periods
    periodCount: 1440 * 2, // 2 days in minutes
    initialUnlockPercent: 1000,
  },
  {
    name: "Advisor Pool",
    cliffDuration: DAY, // 1-day cliff
    periodDuration: MINUTE, // 1-minute periods
    periodCount: 1440 * 3, // 3 days in minutes
    initialUnlockPercent: 2500, // 25% unlocked at start
  },
  {
    name: "Contributor Rewards",
    cliffDuration: 0, // no cliff
    periodDuration: MINUTE, // every minute
    periodCount: 1440 * 5, // 5 days in minutes
    initialUnlockPercent: 0,
  },
] as const;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function verify(address: string, constructorArguments: unknown[] = []): Promise<void> {
  try {
    await hre.run("verify:verify", { address, constructorArguments });
    console.log(`  ok  Verified: ${address}`);
  } catch (err: any) {
    const msg: string = err?.message ?? String(err);
    if (msg.toLowerCase().includes("already verified")) {
      console.log(`  ok  Already verified: ${address}`);
    } else {
      console.warn(`  warn  Verification failed for ${address}:\n    ${msg}`);
    }
  }
}

async function main(): Promise<void> {
  console.log("=== LURVesting -- Sepolia Deployment ===\n");

  const [deployer] = await ethers.getSigners();
  console.log("Deployer  :", deployer.address);
  console.log("ETH balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH\n");

  console.log("1. Deploying LURVesting (UUPS proxy)...");
  const LURVestingFactory = await ethers.getContractFactory("LURVesting");
  const lurVesting = await upgrades.deployProxy(LURVestingFactory, [LUR_TOKEN_ADDRESS, DAO_ADDRESS, deployer.address], {
    kind: "uups",
  });
  await lurVesting.waitForDeployment();
  const vestingAddress = await lurVesting.getAddress();
  const vestingImplAddress = await upgrades.erc1967.getImplementationAddress(vestingAddress);
  console.log("   Proxy :", vestingAddress);
  console.log("   Impl  :", vestingImplAddress);

  console.log("\n2. Creating vesting pools...");
  const poolIds: bigint[] = [];

  for (const pool of VESTING_POOLS) {
    const tx = await (lurVesting as any).createPool({
      name: pool.name,
      cliffDuration: pool.cliffDuration,
      periodDuration: pool.periodDuration,
      periodCount: pool.periodCount,
      initialUnlockPercent: pool.initialUnlockPercent,
    });
    const receipt = await tx.wait();
    const event = receipt.logs.find((l: any) => l.fragment?.name === "PoolCreated");
    const poolId: bigint = event.args[0];
    poolIds.push(poolId);
    console.log(
      `   Pool ${poolId}: "${pool.name}" | cliff=${pool.cliffDuration / DAY}d | period=${pool.periodDuration}s ×${
        pool.periodCount
      }`
    );
  }

  console.log("\n3. Allocating tokens (batch per pool)...");
  const lurToken = await ethers.getContractAt("LURToken", LUR_TOKEN_ADDRESS);
  const recipients = [deployer.address, EXTRA_RECIPIENT];
  const batchTotal = ALLOCATION_AMOUNT * BigInt(recipients.length);
  const start = 0;

  for (let i = 0; i < poolIds.length; i++) {
    const poolId = poolIds[i];
    const poolName = VESTING_POOLS[i].name;

    const entries = recipients.map((r) => ({ recipient: r, amount: ALLOCATION_AMOUNT, start }));

    await (await lurToken.approve(vestingAddress, batchTotal)).wait();
    await (await (lurVesting as any).allocateBatch(poolId, entries)).wait();

    console.log(
      `   Pool ${poolId} "${poolName}": allocated ${ethers.formatEther(ALLOCATION_AMOUNT)} LUR to each of ${
        recipients.length
      } recipients`
    );
  }

  const VERIFY_DELAY_MS = 30_000;
  console.log(`\n4. Waiting ${VERIFY_DELAY_MS / 1000}s before Etherscan verification...`);
  await sleep(VERIFY_DELAY_MS);

  console.log("\n   Verifying LURVesting proxy (+ impl via OZ upgrades plugin)...");
  try {
    await hre.run("verify", { address: vestingAddress });
    console.log(`  ok  Verified: ${vestingAddress}`);
  } catch (err: any) {
    const msg: string = err?.message ?? String(err);
    if (msg.toLowerCase().includes("already verified")) {
      console.log(`  ok  Already verified: ${vestingAddress}`);
    } else {
      console.warn(`  warn  Proxy verification failed:\n    ${msg}`);
    }
  }

  console.log("\n=== Deployment Summary ===");
  console.log("LURToken (existing)   :", LUR_TOKEN_ADDRESS);
  console.log("LURDAO   (existing)   :", DAO_ADDRESS);
  console.log("LURVesting proxy      :", vestingAddress);
  console.log("LURVesting impl       :", vestingImplAddress);
  console.log(`\nPools created         : ${poolIds.length}`);
  console.log(`Allocations per pool  : ${recipients.length} × ${ethers.formatEther(ALLOCATION_AMOUNT)} LUR`);
  console.log("\nRecipients:");
  for (const r of recipients) console.log("  -", r);
  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
