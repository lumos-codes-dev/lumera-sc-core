import { expect } from "chai";
const { ethers } = require("hardhat");

describe("LURVesting", function () {
  let deployer: any, manager: any, beneficiary: any, other: any;
  let lur: any, vesting: any;

  beforeEach(async function () {
    [deployer, manager, beneficiary, other] = await ethers.getSigners();

    const LUR = await ethers.getContractFactory("LURToken");
    const initialSupply = ethers.parseEther("10000");
    lur = await LUR.deploy(deployer.address, initialSupply);
    await lur.waitForDeployment();

    await (await lur.transfer(manager.address, ethers.parseEther("1000"))).wait();

    const LURVesting = await ethers.getContractFactory("LURVesting");
    vesting = await LURVesting.deploy(await lur.getAddress(), deployer.address, manager.address);
    await vesting.waitForDeployment();
  });

  it("creates vesting pool and allows claiming according to schedule", async function () {
    const amount = ethers.parseEther("100");
    await (await lur.connect(manager).approve(await vesting.getAddress(), amount)).wait();

    const schedule = { cliffDuration: 0, periodDuration: 10, periodCount: 4 };
    const initialUnlockPercent = 1000;

    await (
      await vesting.connect(manager).createVestingPool({
        recipient: beneficiary.address,
        amount: amount,
        start: 0,
        schedule,
        initialUnlockPercent,
      })
    ).wait();

    const initialAmount = (amount * BigInt(initialUnlockPercent)) / BigInt(10000);
    expect(await vesting.getClaimableAmount(beneficiary.address)).to.equal(initialAmount);

    const twoPeriods = schedule.periodDuration * 2 + 1;
    await ethers.provider.send("evm_increaseTime", [twoPeriods]);
    await ethers.provider.send("evm_mine", []);

    const passedPeriods = 2;
    const unlocked = initialAmount + ((amount - initialAmount) * BigInt(passedPeriods)) / BigInt(schedule.periodCount);

    expect(await vesting.getClaimableAmount(beneficiary.address)).to.equal(unlocked);

    await (await vesting.connect(beneficiary).claim()).wait();
    expect(await lur.balanceOf(beneficiary.address)).to.equal(unlocked);
  });

  it("reverts when creating vesting with zero recipient", async function () {
    const amount = ethers.parseEther("1");
    await (await lur.connect(manager).approve(await vesting.getAddress(), amount)).wait();

    const params = {
      recipient: ethers.ZeroAddress,
      amount: amount,
      start: 0,
      schedule: { cliffDuration: 0, periodDuration: 1, periodCount: 1 },
      initialUnlockPercent: 0,
    };

    await expect(vesting.connect(manager).createVestingPool(params)).to.be.revertedWithCustomError(
      vesting,
      "LURVesting__ZeroAddress"
    );
  });

  it("reverts when creating vesting with zero amount or invalid schedule", async function () {
    const paramsZeroAmount = {
      recipient: beneficiary.address,
      amount: ethers.parseEther("0"),
      start: 0,
      schedule: { cliffDuration: 0, periodDuration: 1, periodCount: 1 },
      initialUnlockPercent: 0,
    };

    await (await lur.connect(manager).approve(await vesting.getAddress(), ethers.parseEther("1"))).wait();
    await expect(vesting.connect(manager).createVestingPool(paramsZeroAmount)).to.be.revertedWithCustomError(
      vesting,
      "LURVesting__ZeroAmount"
    );

    const paramsZeroSchedule = {
      recipient: beneficiary.address,
      amount: ethers.parseEther("1"),
      start: 0,
      schedule: { cliffDuration: 0, periodDuration: 0, periodCount: 0 },
      initialUnlockPercent: 0,
    };

    await (await lur.connect(manager).approve(await vesting.getAddress(), ethers.parseEther("1"))).wait();
    await expect(vesting.connect(manager).createVestingPool(paramsZeroSchedule)).to.be.revertedWithCustomError(
      vesting,
      "LURVesting__ZeroAmount"
    );
  });

  it("reverts when initialUnlockPercent exceeds 100%", async function () {
    const amount = ethers.parseEther("1");
    await (await lur.connect(manager).approve(await vesting.getAddress(), amount)).wait();

    const params = {
      recipient: beneficiary.address,
      amount: amount,
      start: 0,
      schedule: { cliffDuration: 0, periodDuration: 1, periodCount: 1 },
      initialUnlockPercent: 10001,
    };

    await expect(vesting.connect(manager).createVestingPool(params)).to.be.revertedWithCustomError(
      vesting,
      "LURVesting__InitialUnlockExceedsLimit"
    );
  });

  it("createVestingPoolBatch rejects empty and oversized batches", async function () {
    await expect(vesting.connect(manager).createVestingPoolBatch([])).to.be.revertedWithCustomError(
      vesting,
      "LURVesting__InvalidBatchSize"
    );

    const big = new Array(101).fill({
      recipient: beneficiary.address,
      amount: ethers.parseEther("1"),
      start: 0,
      schedule: { cliffDuration: 0, periodDuration: 1, periodCount: 1 },
      initialUnlockPercent: 0,
    });

    await (await lur.connect(manager).approve(await vesting.getAddress(), ethers.parseEther("200"))).wait();
    await expect(vesting.connect(manager).createVestingPoolBatch(big)).to.be.revertedWithCustomError(
      vesting,
      "LURVesting__InvalidBatchSize"
    );
  });

  it("refund only allows withdrawing non-vested token balance and reverts when insufficient", async function () {
    await (await lur.transfer(await vesting.getAddress(), ethers.parseEther("50"))).wait();

    const amount = ethers.parseEther("30");
    await (await lur.connect(manager).approve(await vesting.getAddress(), amount)).wait();

    await (
      await vesting.connect(manager).createVestingPool({
        recipient: beneficiary.address,
        amount: amount,
        start: 0,
        schedule: { cliffDuration: 0, periodDuration: 1, periodCount: 10 },
        initialUnlockPercent: 0,
      })
    ).wait();

    const withdrawable = ethers.parseEther("50");
    const requested = ethers.parseEther("60");
    await expect(vesting.connect(manager).refund(await lur.getAddress(), other.address, requested))
      .to.be.revertedWithCustomError(vesting, "LURVesting__NotEnoughBalance")
      .withArgs(withdrawable, requested);

    await (await vesting.connect(manager).refund(await lur.getAddress(), other.address, withdrawable)).wait();
    expect(await lur.balanceOf(other.address)).to.equal(withdrawable);
  });

  it("claimFor reverts when no allocations, and full vesting reduces totalVested", async function () {
    await expect(vesting.connect(other).claimFor(other.address)).to.be.revertedWithCustomError(
      vesting,
      "LURVesting__NoAllocationsFound"
    );

    const amount = ethers.parseEther("10");
    await (await lur.connect(manager).approve(await vesting.getAddress(), amount)).wait();
    await (
      await vesting.connect(manager).createVestingPool({
        recipient: beneficiary.address,
        amount: amount,
        start: 0,
        schedule: { cliffDuration: 0, periodDuration: 1, periodCount: 1 },
        initialUnlockPercent: 0,
      })
    ).wait();

    const beforeTotal = await vesting.totalVested();
    await ethers.provider.send("evm_increaseTime", [1000]);
    await ethers.provider.send("evm_mine", []);
    await (await vesting.connect(beneficiary).claim()).wait();
    const afterTotal = await vesting.totalVested();
    expect(afterTotal).to.equal(beforeTotal - amount);
  });

  it("removes pool after beneficiary has claimed full amount", async function () {
    const amount = ethers.parseEther("5");
    await (await lur.connect(manager).approve(await vesting.getAddress(), amount)).wait();
    await (
      await vesting.connect(manager).createVestingPool({
        recipient: beneficiary.address,
        amount: amount,
        start: 0,
        schedule: { cliffDuration: 0, periodDuration: 1, periodCount: 1 },
        initialUnlockPercent: 0,
      })
    ).wait();

    // move forward past vesting
    await ethers.provider.send("evm_increaseTime", [1000]);
    await ethers.provider.send("evm_mine", []);

    // beneficiary claims full amount
    await (await vesting.connect(beneficiary).claim()).wait();

    // subsequent claimFor should revert because pools were removed
    await expect(vesting.connect(beneficiary).claimFor(beneficiary.address)).to.be.revertedWithCustomError(
      vesting,
      "LURVesting__NoAllocationsFound"
    );
  });

  it("createVestingPoolBatch creates multiple pools", async function () {
    const amount = ethers.parseEther("2");
    const params = [
      {
        recipient: beneficiary.address,
        amount: amount,
        start: 0,
        schedule: { cliffDuration: 0, periodDuration: 1, periodCount: 1 },
        initialUnlockPercent: 0,
      },
      {
        recipient: beneficiary.address,
        amount: amount,
        start: 0,
        schedule: { cliffDuration: 0, periodDuration: 1, periodCount: 1 },
        initialUnlockPercent: 0,
      },
    ];

    await (await lur.connect(manager).approve(await vesting.getAddress(), ethers.parseEther("10"))).wait();
    await (await vesting.connect(manager).createVestingPoolBatch(params)).wait();
    await ethers.provider.send("evm_increaseTime", [10]);
    await ethers.provider.send("evm_mine", []);

    const claimable = await vesting.getClaimableAmount(beneficiary.address);
    expect(claimable).to.equal(amount + amount);
  });

  it("swaps and removes non-last pool on full claim", async function () {
    // create two pools: first fully claimable, second locked
    const a = ethers.parseEther("1");
    const b = ethers.parseEther("10");
    await (await lur.connect(manager).approve(await vesting.getAddress(), a + b)).wait();

    await (
      await vesting.connect(manager).createVestingPool({
        recipient: beneficiary.address,
        amount: a,
        start: 0,
        schedule: { cliffDuration: 0, periodDuration: 1, periodCount: 1 },
        initialUnlockPercent: 0,
      })
    ).wait();

    const latest = await ethers.provider.getBlock("latest");
    const futureStart = latest.timestamp + 100000;
    await (
      await vesting.connect(manager).createVestingPool({
        recipient: beneficiary.address,
        amount: b,
        start: futureStart,
        schedule: { cliffDuration: 0, periodDuration: 1, periodCount: 1 },
        initialUnlockPercent: 0,
      })
    ).wait();

    // fast-forward to allow first pool to be claimable
    await ethers.provider.send("evm_increaseTime", [1000]);
    await ethers.provider.send("evm_mine", []);

    // claim should remove first pool and swap/pop with second
    await (await vesting.connect(beneficiary).claim()).wait();

    // ensure beneficiary has received amount a
    expect(await lur.balanceOf(beneficiary.address)).to.equal(a);

    // check claimable amount equals 0 for future pool
    const claimable = await vesting.getClaimableAmount(beneficiary.address);
    expect(claimable).to.equal(0);
  });
});
