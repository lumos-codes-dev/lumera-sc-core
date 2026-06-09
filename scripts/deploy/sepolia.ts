import { ethers, upgrades } from "hardhat";
import hre from "hardhat";

/** Total token supply minted to the deployer. */
const INITIAL_SUPPLY = ethers.parseEther("1000000000");

/**
 * Address that receives VESTING_MANAGER_ROLE.
 * Defaults to deployer so the test pool can be created during the script.
 * Set VESTING_MANAGER in .env to use a different address.
 */
const VESTING_MANAGER_ENV = process.env.VESTING_MANAGER ?? "";

/**
 * Recipient of the test vesting pool.
 */
const TEST_VESTING_BENEFICIARY_ENV = "0x224637236f8C7c8ec3E8bbAe7b77F75d48074043";

/** Amount of LUR tokens placed in the test vesting pool. */
const TEST_VESTING_AMOUNT = ethers.parseEther("1000000");

/** Tokens pre-loaded into LURStaking as reward reserves. */
const STAKING_REWARDS_RESERVE = ethers.parseEther("1000000");

const VOTING_DELAY = 60;
const VOTING_PERIOD = 600;
const PROPOSAL_THRESHOLD = ethers.parseEther("1000");
const QUORUM_PERCENTAGE = 1;
const MIN_TIMELOCK_DELAY = 60;

const STAKING_POOLS = [
  {
    name: "LUR 1-Month Lock",
    lockDuration: 30 * 24 * 3600,
    apr: 7_500,
  },
  {
    name: "LUR 6-Month Lock",
    lockDuration: 180 * 24 * 3600,
    apr: 10_000,
  },
  {
    name: "LUR 1-Year Lock",
    lockDuration: 365 * 24 * 3600,
    apr: 12_500,
  },
  {
    name: "LUR 1-Minute Lock",
    lockDuration: 60,
    apr: 5_000,
  },
] as const;

const MIN_STAKE = ethers.parseEther("1");
const MAX_STAKE = ethers.parseEther("1000000");

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
  console.log("=== LUR Protocol -- Sepolia Deployment ===\n");

  const [deployer] = await ethers.getSigners();
  const vestingManager = VESTING_MANAGER_ENV || deployer.address;
  const vestingBeneficiary = TEST_VESTING_BENEFICIARY_ENV || deployer.address;

  console.log("Deployer           :", deployer.address);
  console.log("Vesting manager    :", vestingManager);
  console.log("Vesting beneficiary:", vestingBeneficiary);
  console.log("ETH balance        :", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH\n");

  console.log("1. Deploying LURToken...");
  const LURTokenFactory = await ethers.getContractFactory("LURToken");
  const lurToken = await LURTokenFactory.deploy(deployer.address, INITIAL_SUPPLY);
  await lurToken.waitForDeployment();
  const lurTokenAddress = await lurToken.getAddress();
  console.log("   Address:", lurTokenAddress);
  console.log("   Supply :", ethers.formatEther(INITIAL_SUPPLY), "LUR");

  console.log("\n2. Deploying TimeLock...");
  const TimeLockFactory = await ethers.getContractFactory("TimeLock");
  const timeLock = await TimeLockFactory.deploy(MIN_TIMELOCK_DELAY, [], [], deployer.address);
  await timeLock.waitForDeployment();
  const timeLockAddress = await timeLock.getAddress();
  console.log("   Address:", timeLockAddress);

  console.log("\n3. Deploying LURDAO...");
  const LURDAOFactory = await ethers.getContractFactory("LURDAO");
  const lurDAO = await LURDAOFactory.deploy(
    lurTokenAddress,
    timeLockAddress,
    VOTING_DELAY,
    VOTING_PERIOD,
    PROPOSAL_THRESHOLD,
    QUORUM_PERCENTAGE
  );
  await lurDAO.waitForDeployment();
  const lurDAOAddress = await lurDAO.getAddress();
  console.log("   Address:", lurDAOAddress);

  console.log("\n4. Deploying LURVesting...");
  const LURVestingFactory = await ethers.getContractFactory("LURVesting");
  const lurVesting = await LURVestingFactory.deploy(lurTokenAddress, lurDAOAddress, vestingManager);
  await lurVesting.waitForDeployment();
  const lurVestingAddress = await lurVesting.getAddress();
  console.log("   Address:", lurVestingAddress);

  console.log("\n5. Deploying LURStaking (UUPS proxy)...");
  const LURStakingFactory = await ethers.getContractFactory("LURStaking");
  const lurStaking = await upgrades.deployProxy(LURStakingFactory, [deployer.address], { kind: "uups" });
  await lurStaking.waitForDeployment();
  const lurStakingAddress = await lurStaking.getAddress();
  const lurStakingImplAddress = await upgrades.erc1967.getImplementationAddress(lurStakingAddress);
  console.log("   Proxy :", lurStakingAddress);
  console.log("   Impl  :", lurStakingImplAddress);

  console.log("\n6. Granting TimeLock roles to DAO...");
  await (await timeLock.grantRole(await timeLock.PROPOSER_ROLE(), lurDAOAddress)).wait();
  await (await timeLock.grantRole(await timeLock.EXECUTOR_ROLE(), lurDAOAddress)).wait();
  console.log("   PROPOSER_ROLE -> DAO");
  console.log("   EXECUTOR_ROLE -> DAO");

  console.log("\n6a. Granting LURStaking roles to deployer...");
  const PAUSER_ROLE = await (lurStaking as any).PAUSER_ROLE();
  const WITHDRAWER_ROLE = await (lurStaking as any).WITHDRAWER_ROLE();
  await (await (lurStaking as any).grantRole(PAUSER_ROLE, deployer.address)).wait();
  await (await (lurStaking as any).grantRole(WITHDRAWER_ROLE, deployer.address)).wait();
  console.log("   PAUSER_ROLE    -> deployer");
  console.log("   WITHDRAWER_ROLE -> deployer");

  console.log("\n7. Creating staking pools...");
  for (const pool of STAKING_POOLS) {
    const tx = await (lurStaking as any).createPool({
      name: pool.name,
      token: lurTokenAddress,
      apr: pool.apr,
      lockDuration: pool.lockDuration,
      minStakeAmount: MIN_STAKE,
      maxStakeAmount: MAX_STAKE,
    });
    await tx.wait();
    console.log(`   Pool created: "${pool.name}" | lock=${pool.lockDuration / 86400}d | APR=${pool.apr / 100}%`);
  }

  console.log("\n   Funding staking contract with reward reserves...");
  await (await lurToken.transfer(lurStakingAddress, STAKING_REWARDS_RESERVE)).wait();
  console.log(`   Transferred ${ethers.formatEther(STAKING_REWARDS_RESERVE)} LUR to staking contract`);

  console.log("\n8. Creating test vesting pool...");
  await (await lurToken.approve(lurVestingAddress, TEST_VESTING_AMOUNT)).wait();

  const vestingStart = Math.floor(Date.now() / 1000);
  await (
    await (lurVesting as any).createVestingPool({
      recipient: vestingBeneficiary,
      amount: TEST_VESTING_AMOUNT,
      start: vestingStart,
      schedule: {
        cliffDuration: 0,
        periodDuration: 1,
        periodCount: 86400 * 30,
      },
      initialUnlockPercent: 0,
    })
  ).wait();
  console.log(
    `   ${ethers.formatEther(TEST_VESTING_AMOUNT)} LUR vested to ${vestingBeneficiary}`,
    "(1 token/second, 1 month in seconds total)"
  );

  const VERIFY_DELAY_MS = 30_000;
  console.log(`\n9. Waiting ${VERIFY_DELAY_MS / 1000}s before Etherscan verification...`);
  await sleep(VERIFY_DELAY_MS);

  console.log("\n   Verifying LURToken...");
  await verify(lurTokenAddress, [deployer.address, INITIAL_SUPPLY]);

  console.log("   Verifying TimeLock...");
  try {
    await hre.run("verify:verify", {
      address: timeLockAddress,
      constructorArguments: [MIN_TIMELOCK_DELAY, [], [], deployer.address],
      contract: "contracts/dao/TimeLock.sol:TimeLock",
    });
    console.log(`  ok  Verified: ${timeLockAddress}`);
  } catch (err: any) {
    const msg: string = err?.message ?? String(err);
    if (msg.toLowerCase().includes("already verified")) {
      console.log(`  ok  Already verified: ${timeLockAddress}`);
    } else {
      console.warn(`  warn  Verification failed for ${timeLockAddress}:\n    ${msg}`);
    }
  }

  console.log("   Verifying LURDAO...");
  await verify(lurDAOAddress, [
    lurTokenAddress,
    timeLockAddress,
    VOTING_DELAY,
    VOTING_PERIOD,
    PROPOSAL_THRESHOLD,
    QUORUM_PERCENTAGE,
  ]);

  console.log("   Verifying LURVesting...");
  await verify(lurVestingAddress, [lurTokenAddress, lurDAOAddress, vestingManager]);

  console.log("   Verifying LURStaking proxy (+ impl via OZ upgrades plugin)...");
  try {
    await hre.run("verify", { address: lurStakingAddress });
    console.log(`  ok  Verified: ${lurStakingAddress}`);
  } catch (err: any) {
    const msg: string = err?.message ?? String(err);
    if (msg.toLowerCase().includes("already verified")) {
      console.log(`  ok  Already verified: ${lurStakingAddress}`);
    } else {
      console.warn(`  warn  Proxy verification failed:\n    ${msg}`);
    }
  }

  console.log("\n=== Deployment Summary ===");
  console.log("LURToken         :", lurTokenAddress);
  console.log("TimeLock         :", timeLockAddress);
  console.log("LURDAO           :", lurDAOAddress);
  console.log("LURVesting       :", lurVestingAddress);
  console.log("LURStaking proxy :", lurStakingAddress);
  console.log("LURStaking impl  :", lurStakingImplAddress);
  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
