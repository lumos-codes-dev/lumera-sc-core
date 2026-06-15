import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";

const { ethers, upgrades } = require("hardhat");

const BPS = 10_000n;
const SECONDS_IN_YEAR = 365n * 24n * 60n * 60n;

async function deployFixture() {
  const [deployer, admin, user, other, treasury, withdrawer] = await ethers.getSigners();

  const LUR = await ethers.getContractFactory("LURToken");
  const initialSupply = ethers.parseEther("1000000");
  const lur = await LUR.deploy(deployer.address, initialSupply);
  await lur.waitForDeployment();

  const Staking = await ethers.getContractFactory("LURStaking");
  const staking = await upgrades.deployProxy(Staking, [admin.address], { kind: "uups" });
  await staking.waitForDeployment();

  const userFunding = ethers.parseEther("2000");
  await (await lur.transfer(user.address, userFunding)).wait();
  await (await lur.transfer(other.address, userFunding)).wait();
  await (await lur.transfer(treasury.address, userFunding)).wait();

  const pauserRole = await staking.PAUSER_ROLE();
  await (await staking.connect(admin).grantRole(pauserRole, admin.address)).wait();

  return { deployer, admin, user, other, treasury, withdrawer, lur, staking };
}

async function createPool(
  staking: any,
  admin: any,
  tokenAddress: string,
  overrides: Partial<{
    name: string;
    apr: number;
    lockDuration: number;
    minStakeAmount: bigint;
    maxStakeAmount: bigint;
  }> = {}
) {
  const params = {
    name: overrides.name ?? "Rewards Pool",
    token: tokenAddress,
    apr: overrides.apr ?? 1_000,
    lockDuration: overrides.lockDuration ?? 365 * 24 * 60 * 60,
    minStakeAmount: overrides.minStakeAmount ?? ethers.parseEther("10"),
    maxStakeAmount: overrides.maxStakeAmount ?? ethers.parseEther("200"),
  };

  await (await staking.connect(admin).createPool(params)).wait();
  return params;
}

async function increaseTime(seconds: number) {
  await ethers.provider.send("evm_increaseTime", [seconds]);
  await ethers.provider.send("evm_mine", []);
}

function calculateRewards(amount: bigint, apr: number, lockDuration: number) {
  return (((amount * BigInt(apr)) / BPS) * BigInt(lockDuration)) / SECONDS_IN_YEAR;
}

describe("LURStaking", function () {
  it("initializes through a proxy and rejects a zero admin", async function () {
    const { staking, admin } = await loadFixture(deployFixture);

    expect(await staking.hasRole(await staking.DEFAULT_ADMIN_ROLE(), admin.address)).to.equal(true);

    const Staking = await ethers.getContractFactory("LURStaking");
    await expect(upgrades.deployProxy(Staking, [ethers.ZeroAddress], { kind: "uups" })).to.be.revertedWithCustomError(
      Staking,
      "LURStaking__ZeroAddress"
    );
  });

  it("creates pools and exposes pool and pagination data", async function () {
    const { staking, admin, user, lur } = await loadFixture(deployFixture);

    const firstPool = await createPool(staking, admin, await lur.getAddress(), { name: "Rewards One" });
    const secondPool = await createPool(staking, admin, await lur.getAddress(), { name: "Rewards Two" });

    expect(await staking.getTotalPools()).to.equal(2n);

    const pool = await staking.getPool(0);
    expect(pool.name).to.equal(firstPool.name);
    expect(pool.token).to.equal(await lur.getAddress());
    expect(pool.apr).to.equal(BigInt(firstPool.apr));
    expect(pool.lockDuration).to.equal(BigInt(firstPool.lockDuration));
    expect(pool.minStakeAmount).to.equal(firstPool.minStakeAmount);
    expect(pool.maxStakeAmount).to.equal(firstPool.maxStakeAmount);
    expect(pool.totalStaked).to.equal(0n);

    const emptyByLimit = await staking.getPools(user.address, 0, 0);
    expect(emptyByLimit).to.have.length(0);

    const emptyByOffset = await staking.getPools(user.address, 5, 1);
    expect(emptyByOffset).to.have.length(0);

    const paged = await staking.getPools(user.address, 1, 5);
    expect(paged).to.have.length(1);
    expect(paged[0].id).to.equal(1n);
    expect(paged[0].name).to.equal(secondPool.name);
    expect(paged[0].token).to.equal(await lur.getAddress());
    expect(paged[0].stakingPaused).to.equal(false);
    expect(paged[0].unstakingPaused).to.equal(false);
    expect(paged[0].totalStaked).to.equal(0n);
    expect(paged[0].stakedByUser).to.equal(0n);
    expect(paged[0].stakedByUserAt).to.equal(0n);
    expect(paged[0].lockedUntilForUser).to.equal(0n);
    expect(paged[0].pendingRewards).to.equal(0n);
    expect(paged[0].isTokensLocked).to.equal(false);
  });

  it("validates pool creation parameters", async function () {
    const { staking, admin, lur } = await loadFixture(deployFixture);
    const token = await lur.getAddress();

    await expect(
      staking.connect(admin).createPool({
        name: "x".repeat(65),
        token,
        apr: 1_000,
        lockDuration: 1,
        minStakeAmount: ethers.parseEther("1"),
        maxStakeAmount: ethers.parseEther("2"),
      })
    ).to.be.revertedWithCustomError(staking, "LURStaking__InvalidName");

    await expect(
      staking.connect(admin).createPool({
        name: "Valid",
        token: ethers.ZeroAddress,
        apr: 1_000,
        lockDuration: 1,
        minStakeAmount: ethers.parseEther("1"),
        maxStakeAmount: ethers.parseEther("2"),
      })
    ).to.be.revertedWithCustomError(staking, "LURStaking__ZeroAddress");

    await expect(
      staking.connect(admin).createPool({
        name: "Valid",
        token,
        apr: 0,
        lockDuration: 1,
        minStakeAmount: ethers.parseEther("1"),
        maxStakeAmount: ethers.parseEther("2"),
      })
    ).to.be.revertedWithCustomError(staking, "LURStaking__ZeroAmount");

    await expect(
      staking.connect(admin).createPool({
        name: "Valid",
        token,
        apr: 1_000,
        lockDuration: 0,
        minStakeAmount: ethers.parseEther("1"),
        maxStakeAmount: ethers.parseEther("2"),
      })
    ).to.be.revertedWithCustomError(staking, "LURStaking__ZeroAmount");

    await expect(
      staking.connect(admin).createPool({
        name: "Valid",
        token,
        apr: 1_000,
        lockDuration: 1,
        minStakeAmount: ethers.parseEther("3"),
        maxStakeAmount: ethers.parseEther("2"),
      })
    ).to.be.revertedWithCustomError(staking, "LURStaking__InvalidAmounts");
  });

  it("stakes tokens, updates accounting, and respects pause flags", async function () {
    const { staking, admin, user, lur } = await loadFixture(deployFixture);
    const token = await lur.getAddress();
    const poolParams = await createPool(staking, admin, token, {
      apr: 1_000,
      lockDuration: 365 * 24 * 60 * 60,
      minStakeAmount: ethers.parseEther("10"),
      maxStakeAmount: ethers.parseEther("200"),
    });

    const stakeAmount = ethers.parseEther("50");
    await (await lur.connect(user).approve(await staking.getAddress(), stakeAmount)).wait();

    const expectedRewards = calculateRewards(stakeAmount, poolParams.apr, poolParams.lockDuration);
    await expect(staking.connect(user).stake(0, stakeAmount)).to.emit(staking, "Staked");

    const userStake = await staking.getUserStakeDetails(user.address, 0);
    expect(userStake[0]).to.equal(stakeAmount);
    expect(userStake[2]).to.equal(expectedRewards);
    expect(userStake[3]).to.equal(true);
    expect(userStake[1]).to.be.greaterThan(0n);

    const pools = await staking.getPools(user.address, 0, 1);
    expect(pools[0].stakedByUser).to.equal(stakeAmount);
    expect(pools[0].stakedByUserAt).to.equal(userStake[1] - BigInt(poolParams.lockDuration));
    expect(pools[0].lockedUntilForUser).to.equal(userStake[1]);
    expect(pools[0].pendingRewards).to.equal(expectedRewards);
    expect(pools[0].isTokensLocked).to.equal(true);

    await (await staking.connect(admin).pause()).wait();

    const pausedPools = await staking.getPools(user.address, 0, 1);
    expect(pausedPools[0].stakingPaused).to.equal(true);
    expect(pausedPools[0].unstakingPaused).to.equal(true);

    await (await lur.connect(user).approve(await staking.getAddress(), ethers.parseEther("1"))).wait();
    await expect(staking.connect(user).stake(0, ethers.parseEther("1"))).to.be.revertedWithCustomError(
      staking,
      "EnforcedPause"
    );
    await expect(staking.connect(user).unstake(0, true)).to.be.revertedWithCustomError(staking, "EnforcedPause");

    await (await staking.connect(admin).unpause()).wait();

    await (await staking.connect(admin).setStakingPaused(0, true)).wait();
    const stakingPausedPools = await staking.getPools(user.address, 0, 1);
    expect(stakingPausedPools[0].stakingPaused).to.equal(true);
    expect(stakingPausedPools[0].unstakingPaused).to.equal(false);

    await expect(staking.connect(user).stake(0, ethers.parseEther("1"))).to.be.revertedWithCustomError(
      staking,
      "LURStaking__StakingPaused"
    );

    await (await staking.connect(admin).setStakingPaused(0, false)).wait();
    await (await staking.connect(admin).setUnstakingPaused(0, true)).wait();

    await expect(staking.connect(user).unstake(0, true)).to.be.revertedWithCustomError(
      staking,
      "LURStaking__UnstakingPaused"
    );
  });

  it("unstakes after the lock with rewards and supports forced unstake", async function () {
    const { staking, admin, user, lur } = await loadFixture(deployFixture);
    const token = await lur.getAddress();
    const poolParams = await createPool(staking, admin, token, {
      apr: 1_000,
      lockDuration: 365 * 24 * 60 * 60,
      minStakeAmount: ethers.parseEther("10"),
      maxStakeAmount: ethers.parseEther("200"),
    });

    const stakeAmount = ethers.parseEther("100");
    const rewards = calculateRewards(stakeAmount, poolParams.apr, poolParams.lockDuration);
    await (await lur.transfer(await staking.getAddress(), rewards)).wait();
    await (await lur.connect(user).approve(await staking.getAddress(), stakeAmount)).wait();
    await (await staking.connect(user).stake(0, stakeAmount)).wait();

    await expect(staking.connect(user).unstake(0, false)).to.be.revertedWithCustomError(
      staking,
      "LURStaking__TokensLocked"
    );

    const beforeLock = await staking.getUserStakeDetails(user.address, 0);
    expect(beforeLock[3]).to.equal(true);

    await increaseTime(poolParams.lockDuration);

    await expect(staking.connect(user).unstake(0, false))
      .to.emit(staking, "Unstaked")
      .withArgs(user.address, 0, token, stakeAmount, rewards, false);

    expect(await lur.balanceOf(user.address)).to.equal(ethers.parseEther("2010"));
    expect(await staking.getTotalPools()).to.equal(1n);

    const postUnstake = await staking.getUserStakeDetails(user.address, 0);
    expect(postUnstake[0]).to.equal(0n);
    expect(postUnstake[1]).to.equal(0n);
    expect(postUnstake[2]).to.equal(0n);
    expect(postUnstake[3]).to.equal(false);

    await (await lur.connect(user).approve(await staking.getAddress(), stakeAmount)).wait();
    await (await staking.connect(user).stake(0, stakeAmount)).wait();
    await expect(staking.connect(user).unstake(0, true))
      .to.emit(staking, "Unstaked")
      .withArgs(user.address, 0, token, stakeAmount, 0, true);
  });

  it("rejects invalid stake and unstake paths", async function () {
    const { staking, admin, user, lur } = await loadFixture(deployFixture);
    await createPool(staking, admin, await lur.getAddress(), {
      apr: 1_000,
      lockDuration: 365 * 24 * 60 * 60,
      minStakeAmount: ethers.parseEther("10"),
      maxStakeAmount: ethers.parseEther("200"),
    });

    await expect(staking.connect(user).stake(1, ethers.parseEther("1"))).to.be.revertedWithCustomError(
      staking,
      "LURStaking__PoolNotExists"
    );

    await expect(staking.connect(user).stake(0, 0)).to.be.revertedWithCustomError(staking, "LURStaking__ZeroAmount");

    await (await lur.connect(user).approve(await staking.getAddress(), ethers.parseEther("5"))).wait();
    await expect(staking.connect(user).stake(0, ethers.parseEther("5"))).to.be.revertedWithCustomError(
      staking,
      "LURStaking__AmountTooLow"
    );

    await (await lur.connect(user).approve(await staking.getAddress(), ethers.parseEther("300"))).wait();
    await expect(staking.connect(user).stake(0, ethers.parseEther("250"))).to.be.revertedWithCustomError(
      staking,
      "LURStaking__AmountTooHigh"
    );

    await expect(staking.connect(user).unstake(0, false)).to.be.revertedWithCustomError(
      staking,
      "LURStaking__ZeroAmount"
    );

    await expect(staking.connect(user).unstake(1, false)).to.be.revertedWithCustomError(
      staking,
      "LURStaking__PoolNotExists"
    );

    await (await staking.connect(admin).setUnstakingPaused(0, true)).wait();
    await expect(staking.connect(user).unstake(0, true)).to.be.revertedWithCustomError(
      staking,
      "LURStaking__UnstakingPaused"
    );
  });

  it("refunds ERC20 and ETH balances only when withdrawable, and handles transfer failures", async function () {
    const { staking, admin, user, other, treasury, withdrawer, lur } = await loadFixture(deployFixture);
    const token = await lur.getAddress();

    const firstPool = await createPool(staking, admin, token, {
      apr: 1_000,
      lockDuration: 365 * 24 * 60 * 60,
      minStakeAmount: ethers.parseEther("10"),
      maxStakeAmount: ethers.parseEther("200"),
    });
    const secondPool = await createPool(staking, admin, token, {
      name: "Rewards Two",
      apr: 1_000,
      lockDuration: 365 * 24 * 60 * 60,
      minStakeAmount: ethers.parseEther("10"),
      maxStakeAmount: ethers.parseEther("200"),
    });

    const firstStake = ethers.parseEther("100");
    const secondStake = ethers.parseEther("50");
    const firstRewards = calculateRewards(firstStake, firstPool.apr, firstPool.lockDuration);
    const secondRewards = calculateRewards(secondStake, secondPool.apr, secondPool.lockDuration);

    await (await lur.transfer(await staking.getAddress(), ethers.parseEther("200"))).wait();
    await (await lur.connect(user).approve(await staking.getAddress(), firstStake)).wait();
    await (await staking.connect(user).stake(0, firstStake)).wait();
    await (await lur.connect(other).approve(await staking.getAddress(), secondStake)).wait();
    await (await staking.connect(other).stake(1, secondStake)).wait();

    await expect(staking.connect(other).refund(token, treasury.address, 1)).to.be.revertedWithCustomError(
      staking,
      "AccessControlUnauthorizedAccount"
    );

    const withdrawerRole = await staking.WITHDRAWER_ROLE();
    await (await staking.connect(admin).grantRole(withdrawerRole, withdrawer.address)).wait();

    const withdrawable = ethers.parseEther("200") - firstRewards - secondRewards;
    await expect(
      staking.connect(withdrawer).refund(token, treasury.address, withdrawable + 1n)
    ).to.be.revertedWithCustomError(staking, "LURStaking__WithdrawAmountExceedsWithdrawableBalance");

    await expect(staking.connect(withdrawer).refund(token, treasury.address, withdrawable))
      .to.emit(staking, "Refund")
      .withArgs(token, treasury.address, withdrawable);
    expect(await lur.balanceOf(treasury.address)).to.equal(ethers.parseEther("2000") + withdrawable);

    const ethBalance = ethers.parseEther("5");
    await ethers.provider.send("hardhat_setBalance", [await staking.getAddress(), `0x${ethBalance.toString(16)}`]);

    const Target = await ethers.getContractFactory("TestTarget");
    const target = await Target.deploy();
    await target.waitForDeployment();

    await expect(
      staking.connect(withdrawer).refund(ethers.ZeroAddress, await target.getAddress(), ethers.parseEther("1"))
    ).to.be.revertedWithCustomError(staking, "LURStaking__TransferFailed");

    await expect(staking.connect(withdrawer).refund(ethers.ZeroAddress, other.address, ethers.parseEther("1")))
      .to.emit(staking, "Refund")
      .withArgs(ethers.ZeroAddress, other.address, ethers.parseEther("1"));
  });

  it("refund rejects zero recipient and zero amount", async function () {
    const { staking, admin, user, withdrawer, lur } = await loadFixture(deployFixture);
    const token = await lur.getAddress();

    const withdrawerRole = await staking.WITHDRAWER_ROLE();
    await (await staking.connect(admin).grantRole(withdrawerRole, withdrawer.address)).wait();

    await expect(
      staking.connect(withdrawer).refund(token, ethers.ZeroAddress, ethers.parseEther("1"))
    ).to.be.revertedWithCustomError(staking, "LURStaking__ZeroAddress");

    await expect(staking.connect(withdrawer).refund(token, user.address, 0)).to.be.revertedWithCustomError(
      staking,
      "LURStaking__ZeroAmount"
    );
  });

  it("validates additional createPool edge cases and emits PoolCreated", async function () {
    const { staking, admin, user, lur } = await loadFixture(deployFixture);
    const token = await lur.getAddress();
    const baseParams = {
      name: "Valid",
      token,
      apr: 1_000,
      lockDuration: 1,
      minStakeAmount: 0n,
      maxStakeAmount: ethers.parseEther("1"),
    };

    await expect(staking.connect(user).createPool(baseParams)).to.be.revertedWithCustomError(
      staking,
      "AccessControlUnauthorizedAccount"
    );

    await expect(
      staking.connect(admin).createPool({ ...baseParams, name: "" })
    ).to.be.revertedWithCustomError(staking, "LURStaking__InvalidName");

    await expect(
      staking.connect(admin).createPool({ ...baseParams, maxStakeAmount: 0n })
    ).to.be.revertedWithCustomError(staking, "LURStaking__ZeroAmount");

    await expect(staking.connect(admin).createPool({ ...baseParams, name: "x".repeat(64) }))
      .to.emit(staking, "PoolCreated")
      .withArgs(0, token);
  });

  it("enforces role access and pool existence on pause setters", async function () {
    const { staking, admin, user, lur } = await loadFixture(deployFixture);
    await createPool(staking, admin, await lur.getAddress());

    await expect(staking.connect(user).setStakingPaused(0, true)).to.be.revertedWithCustomError(
      staking,
      "AccessControlUnauthorizedAccount"
    );
    await expect(staking.connect(user).setUnstakingPaused(0, true)).to.be.revertedWithCustomError(
      staking,
      "AccessControlUnauthorizedAccount"
    );

    await expect(staking.connect(admin).setStakingPaused(99, true)).to.be.revertedWithCustomError(
      staking,
      "LURStaking__PoolNotExists"
    );
    await expect(staking.connect(admin).setUnstakingPaused(99, true)).to.be.revertedWithCustomError(
      staking,
      "LURStaking__PoolNotExists"
    );
  });

  it("calculateRewards returns correct values for both overloads", async function () {
    const { staking, admin, lur } = await loadFixture(deployFixture);
    const poolParams = await createPool(staking, admin, await lur.getAddress(), {
      apr: 1_000,
      lockDuration: 365 * 24 * 60 * 60,
      minStakeAmount: ethers.parseEther("10"),
      maxStakeAmount: ethers.parseEther("200"),
    });

    const amount = ethers.parseEther("100");
    const expected = calculateRewards(amount, poolParams.apr, poolParams.lockDuration);

    expect(
      await staking["calculateRewards(uint32,uint256,uint32)"](poolParams.apr, amount, poolParams.lockDuration)
    ).to.equal(expected);

    expect(await staking["calculateRewards(uint256,uint256)"](0, amount)).to.equal(expected);

    await expect(staking["calculateRewards(uint256,uint256)"](99, amount)).to.be.revertedWithCustomError(
      staking,
      "LURStaking__PoolNotExists"
    );
  });

  it("allows topping up an existing stake, accumulates amount, and resets lock", async function () {
    const { staking, admin, user, lur } = await loadFixture(deployFixture);
    const poolParams = await createPool(staking, admin, await lur.getAddress(), {
      apr: 1_000,
      lockDuration: 365 * 24 * 60 * 60,
      minStakeAmount: ethers.parseEther("10"),
      maxStakeAmount: ethers.parseEther("200"),
    });

    const firstStake = ethers.parseEther("50");
    const topUp = ethers.parseEther("30");

    await (await lur.connect(user).approve(await staking.getAddress(), firstStake + topUp)).wait();
    await (await staking.connect(user).stake(0, firstStake)).wait();
    const afterFirst = await staking.getUserStakeDetails(user.address, 0);

    await increaseTime(100);

    await expect(staking.connect(user).stake(0, topUp)).to.emit(staking, "Staked");

    const afterTopUp = await staking.getUserStakeDetails(user.address, 0);
    expect(afterTopUp[0]).to.equal(firstStake + topUp);
    expect(afterTopUp[1]).to.be.greaterThan(afterFirst[1]);
    expect(afterTopUp[2]).to.equal(calculateRewards(firstStake + topUp, poolParams.apr, poolParams.lockDuration));
  });

  it("allows admin to upgrade the proxy and rejects unauthorized upgrades", async function () {
    const { staking, admin, user } = await loadFixture(deployFixture);

    const StakingAsUser = await ethers.getContractFactory("LURStaking", user);
    await expect(
      upgrades.upgradeProxy(await staking.getAddress(), StakingAsUser, { kind: "uups" })
    ).to.be.revertedWithCustomError(staking, "AccessControlUnauthorizedAccount");

    const StakingAsAdmin = await ethers.getContractFactory("LURStaking", admin);
    await expect(upgrades.upgradeProxy(await staking.getAddress(), StakingAsAdmin, { kind: "uups" })).to.not.be
      .reverted;
  });
});
