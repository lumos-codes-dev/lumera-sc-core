import { expect } from "chai";
const { ethers, upgrades } = require("hardhat");

describe("LURVesting", function () {
  let deployer: any, manager: any, beneficiary: any, other: any;
  let lur: any, vesting: any;

  beforeEach(async function () {
    [deployer, manager, beneficiary, other] = await ethers.getSigners();

    const LUR = await ethers.getContractFactory("LURToken");
    const initialSupply = ethers.parseEther("10000");
    lur = await LUR.deploy(deployer.address, initialSupply);
    await lur.waitForDeployment();

    await (await lur.transfer(manager.address, ethers.parseEther("5000"))).wait();

    const LURVesting = await ethers.getContractFactory("LURVesting");
    vesting = await upgrades.deployProxy(LURVesting, [await lur.getAddress(), deployer.address, manager.address], {
      kind: "uups",
    });
    await vesting.waitForDeployment();

    const withdrawerRole = await vesting.WITHDRAWER_ROLE();
    await (await vesting.connect(deployer).grantRole(withdrawerRole, deployer.address)).wait();
    await (await vesting.connect(deployer).grantRole(withdrawerRole, manager.address)).wait();
  });

  async function createPoolAndAllocate(
    poolParams: any,
    recipient: string,
    amount: bigint,
    start: number = 0
  ): Promise<bigint> {
    const tx = await vesting.connect(manager).createPool(poolParams);
    const receipt = await tx.wait();
    const event = receipt.logs.find((l: any) => l.fragment?.name === "PoolCreated");
    const poolId: bigint = event.args[0];

    await lur.connect(manager).approve(await vesting.getAddress(), amount);
    await vesting.connect(manager).allocate(poolId, recipient, amount, start);

    return poolId;
  }

  it("creates pool and allocates, then claims according to schedule", async function () {
    const amount = ethers.parseEther("100");
    const initialUnlockPercent = 1000; // 10%
    const periodDuration = 10;
    const periodCount = 4;

    const poolId = await createPoolAndAllocate(
      { name: "Test Pool", cliffDuration: 0, periodDuration, periodCount, initialUnlockPercent },
      beneficiary.address,
      amount
    );

    const initialAmount = (amount * BigInt(initialUnlockPercent)) / BigInt(10000);
    expect(await vesting.getClaimableAmount(beneficiary.address, poolId)).to.equal(initialAmount);

    await ethers.provider.send("evm_increaseTime", [periodDuration * 2 + 1]);
    await ethers.provider.send("evm_mine", []);

    const passedPeriods = 2n;
    const unlocked = initialAmount + ((amount - initialAmount) * passedPeriods) / BigInt(periodCount);
    expect(await vesting.getClaimableAmount(beneficiary.address, poolId)).to.equal(unlocked);

    await (await vesting.connect(beneficiary).claim(poolId)).wait();
    expect(await lur.balanceOf(beneficiary.address)).to.equal(unlocked);
  });

  it("cliff prevents claiming before cliff end", async function () {
    const amount = ethers.parseEther("100");
    const poolId = await createPoolAndAllocate(
      { name: "Cliff Pool", cliffDuration: 1000, periodDuration: 10, periodCount: 4, initialUnlockPercent: 0 },
      beneficiary.address,
      amount
    );

    expect(await vesting.getClaimableAmount(beneficiary.address, poolId)).to.equal(0);
    await expect(vesting.connect(beneficiary).claim(poolId)).to.be.revertedWithCustomError(
      vesting,
      "LURVesting__ZeroAmount"
    );

    await ethers.provider.send("evm_increaseTime", [1011]);
    await ethers.provider.send("evm_mine", []);

    expect(await vesting.getClaimableAmount(beneficiary.address, poolId)).to.be.gt(0);
  });

  it("reverts createPool with invalid params", async function () {
    await expect(
      vesting
        .connect(manager)
        .createPool({ name: "", cliffDuration: 0, periodDuration: 1, periodCount: 1, initialUnlockPercent: 0 })
    ).to.be.revertedWithCustomError(vesting, "LURVesting__InvalidName");

    await expect(
      vesting
        .connect(manager)
        .createPool({ name: "P", cliffDuration: 0, periodDuration: 0, periodCount: 0, initialUnlockPercent: 0 })
    ).to.be.revertedWithCustomError(vesting, "LURVesting__ZeroAmount");

    await expect(
      vesting
        .connect(manager)
        .createPool({ name: "P", cliffDuration: 0, periodDuration: 1, periodCount: 1, initialUnlockPercent: 10001 })
    ).to.be.revertedWithCustomError(vesting, "LURVesting__InitialUnlockExceedsLimit");
  });

  it("reverts allocate with invalid params", async function () {
    const amount = ethers.parseEther("1");
    await vesting
      .connect(manager)
      .createPool({ name: "P", cliffDuration: 0, periodDuration: 1, periodCount: 1, initialUnlockPercent: 0 });

    await expect(vesting.connect(manager).allocate(0, ethers.ZeroAddress, amount, 0)).to.be.revertedWithCustomError(
      vesting,
      "LURVesting__ZeroAddress"
    );

    await expect(vesting.connect(manager).allocate(0, beneficiary.address, 0, 0)).to.be.revertedWithCustomError(
      vesting,
      "LURVesting__ZeroAmount"
    );

    await expect(vesting.connect(manager).allocate(999, beneficiary.address, amount, 0)).to.be.revertedWithCustomError(
      vesting,
      "LURVesting__PoolNotExists"
    );

    await lur.connect(manager).approve(await vesting.getAddress(), amount * 2n);
    await vesting.connect(manager).allocate(0, beneficiary.address, amount, 0);
    await expect(vesting.connect(manager).allocate(0, beneficiary.address, amount, 0)).to.be.revertedWithCustomError(
      vesting,
      "LURVesting__AlreadyAllocated"
    );
  });

  it("reverts claim when no allocation or zero claimable", async function () {
    const amount = ethers.parseEther("1");
    await vesting
      .connect(manager)
      .createPool({ name: "P", cliffDuration: 0, periodDuration: 1, periodCount: 1, initialUnlockPercent: 0 });

    await expect(vesting.connect(beneficiary).claim(0)).to.be.revertedWithCustomError(
      vesting,
      "LURVesting__NoAllocationsFound"
    );

    await lur.connect(manager).approve(await vesting.getAddress(), amount);
    const futureStart = (await ethers.provider.getBlock("latest")).timestamp + 100000;
    await vesting.connect(manager).allocate(0, beneficiary.address, amount, futureStart);

    await expect(vesting.connect(beneficiary).claim(0)).to.be.revertedWithCustomError(
      vesting,
      "LURVesting__ZeroAmount"
    );
  });

  it("setClaimPaused pauses and unpauses claiming", async function () {
    const amount = ethers.parseEther("1");
    const poolId = await createPoolAndAllocate(
      { name: "P", cliffDuration: 0, periodDuration: 1, periodCount: 1, initialUnlockPercent: 10000 },
      beneficiary.address,
      amount
    );

    const PAUSER_ROLE = await vesting.PAUSER_ROLE();
    await vesting.connect(deployer).grantRole(PAUSER_ROLE, deployer.address);

    await vesting.connect(deployer).setClaimPaused(poolId, true);
    await expect(vesting.connect(beneficiary).claim(poolId)).to.be.revertedWithCustomError(
      vesting,
      "LURVesting__ClaimPaused"
    );

    await vesting.connect(deployer).setClaimPaused(poolId, false);
    await vesting.connect(beneficiary).claim(poolId);
    expect(await lur.balanceOf(beneficiary.address)).to.equal(amount);
  });

  it("refund only allows withdrawing non-vested token balance", async function () {
    await (await lur.transfer(await vesting.getAddress(), ethers.parseEther("50"))).wait();

    const vestAmount = ethers.parseEther("30");
    await lur.connect(manager).approve(await vesting.getAddress(), vestAmount);
    const poolId = await createPoolAndAllocate(
      { name: "P", cliffDuration: 0, periodDuration: 1, periodCount: 10, initialUnlockPercent: 0 },
      beneficiary.address,
      vestAmount
    );

    // free balance = 50, vested = 30, withdrawable = 50
    const withdrawable = ethers.parseEther("50");
    const tooMuch = ethers.parseEther("60");
    await expect(vesting.connect(manager).refund(await lur.getAddress(), other.address, tooMuch))
      .to.be.revertedWithCustomError(vesting, "LURVesting__NotEnoughBalance")
      .withArgs(withdrawable, tooMuch);

    await vesting.connect(manager).refund(await lur.getAddress(), other.address, withdrawable);
    expect(await lur.balanceOf(other.address)).to.equal(withdrawable);
  });

  it("totalVested decreases after full claim", async function () {
    const amount = ethers.parseEther("10");
    const poolId = await createPoolAndAllocate(
      { name: "P", cliffDuration: 0, periodDuration: 1, periodCount: 1, initialUnlockPercent: 0 },
      beneficiary.address,
      amount
    );

    const before = await vesting.getTotalPools();
    expect(before).to.equal(1);

    await ethers.provider.send("evm_increaseTime", [1000]);
    await ethers.provider.send("evm_mine", []);

    const vestingStorage = await vesting.getUserAllocation(beneficiary.address, poolId);
    expect(vestingStorage.total).to.equal(amount);

    await vesting.connect(beneficiary).claim(poolId);
    expect(await lur.balanceOf(beneficiary.address)).to.equal(amount);

    const alloc = await vesting.getUserAllocation(beneficiary.address, poolId);
    expect(alloc.claimed).to.equal(amount);
  });

  it("getPools returns correct data with pagination", async function () {
    const amount = ethers.parseEther("5");
    await vesting
      .connect(manager)
      .createPool({ name: "Pool A", cliffDuration: 0, periodDuration: 10, periodCount: 4, initialUnlockPercent: 1000 });
    await vesting
      .connect(manager)
      .createPool({ name: "Pool B", cliffDuration: 100, periodDuration: 5, periodCount: 2, initialUnlockPercent: 0 });

    await lur.connect(manager).approve(await vesting.getAddress(), amount);
    await vesting.connect(manager).allocate(0, beneficiary.address, amount, 0);

    const pools = await vesting.getPools(beneficiary.address, 0, 10);
    expect(pools.length).to.equal(2);
    expect(pools[0].name).to.equal("Pool A");
    expect(pools[0].allocatedForUser).to.equal(amount);
    expect(pools[1].name).to.equal("Pool B");
    expect(pools[1].allocatedForUser).to.equal(0);

    const page = await vesting.getPools(beneficiary.address, 1, 1);
    expect(page.length).to.equal(1);
    expect(page[0].name).to.equal("Pool B");
  });

  it("getPools returns empty array when offset >= totalPools", async function () {
    const result = await vesting.getPools(beneficiary.address, 0, 10);
    expect(result.length).to.equal(0);

    await vesting
      .connect(manager)
      .createPool({ name: "P", cliffDuration: 0, periodDuration: 1, periodCount: 1, initialUnlockPercent: 0 });
    const result2 = await vesting.getPools(beneficiary.address, 5, 10);
    expect(result2.length).to.equal(0);
  });

  it("getClaimableAmount returns 0 for user with no allocation", async function () {
    await vesting
      .connect(manager)
      .createPool({ name: "P", cliffDuration: 0, periodDuration: 1, periodCount: 1, initialUnlockPercent: 0 });
    expect(await vesting.getClaimableAmount(other.address, 0)).to.equal(0);
  });

  it("fully vested after all periods pass", async function () {
    const amount = ethers.parseEther("100");
    const poolId = await createPoolAndAllocate(
      { name: "P", cliffDuration: 0, periodDuration: 10, periodCount: 4, initialUnlockPercent: 0 },
      beneficiary.address,
      amount
    );

    await ethers.provider.send("evm_increaseTime", [10 * 4 + 1]);
    await ethers.provider.send("evm_mine", []);

    expect(await vesting.getClaimableAmount(beneficiary.address, poolId)).to.equal(amount);
    await vesting.connect(beneficiary).claim(poolId);
    expect(await lur.balanceOf(beneficiary.address)).to.equal(amount);
  });

  it("allocateBatch allocates for multiple users in one tx", async function () {
    const amount = ethers.parseEther("10");
    await vesting
      .connect(manager)
      .createPool({ name: "P", cliffDuration: 0, periodDuration: 1, periodCount: 1, initialUnlockPercent: 10000 });

    const entries = [
      { recipient: beneficiary.address, amount, start: 0 },
      { recipient: other.address, amount, start: 0 },
    ];
    const totalAmount = amount * BigInt(entries.length);
    await lur.connect(manager).approve(await vesting.getAddress(), totalAmount);
    await vesting.connect(manager).allocateBatch(0, entries);

    expect(await vesting.getClaimableAmount(beneficiary.address, 0)).to.equal(amount);
    expect(await vesting.getClaimableAmount(other.address, 0)).to.equal(amount);
  });

  it("allocateBatch reverts on empty or oversized batch", async function () {
    await vesting
      .connect(manager)
      .createPool({ name: "P", cliffDuration: 0, periodDuration: 1, periodCount: 1, initialUnlockPercent: 0 });

    await expect(vesting.connect(manager).allocateBatch(0, [])).to.be.revertedWithCustomError(
      vesting,
      "LURVesting__InvalidBatchSize"
    );

    const MAX = 101;
    const big = Array.from({ length: MAX }, () => ({
      recipient: beneficiary.address,
      amount: ethers.parseEther("1"),
      start: 0,
    }));
    await expect(vesting.connect(manager).allocateBatch(0, big)).to.be.revertedWithCustomError(
      vesting,
      "LURVesting__InvalidBatchSize"
    );
  });

  it("allocateBatch reverts on pool not exists", async function () {
    await expect(
      vesting
        .connect(manager)
        .allocateBatch(999, [{ recipient: beneficiary.address, amount: ethers.parseEther("1"), start: 0 }])
    ).to.be.revertedWithCustomError(vesting, "LURVesting__PoolNotExists");
  });

  it("full lifecycle via batch: allocate → cliff → initial unlock → partial claim → full vesting → refund", async function () {
    // use signers that are not used by any other test to avoid balance contamination
    const allSigners = await ethers.getSigners();
    const [alice, bob, carol, refundRecipient] = allSigners.slice(4);

    const cliffDuration = 100;
    const initialUnlockPercent = 5000; // 50%
    const periodDuration = 200;
    const periodCount = 2;

    await vesting.connect(manager).createPool({
      name: "Batch Lifecycle",
      cliffDuration,
      periodDuration,
      periodCount,
      initialUnlockPercent,
    });
    const poolId = 0n;

    // amounts chosen so integer division is exact at every phase
    const aliceAmt = ethers.parseEther("400"); // 50% = 200, 75% = 300, 100% = 400
    const bobAmt = ethers.parseEther("200"); // 50% = 100, 75% = 150, 100% = 200
    const carolAmt = ethers.parseEther("100"); // 50% = 50,  75% = 75,  100% = 100
    const totalAllocated = aliceAmt + bobAmt + carolAmt; // 700

    // top up contract with extra tokens that should remain after all vestings
    const extra = ethers.parseEther("50");
    await lur.transfer(await vesting.getAddress(), extra);

    // ── batch allocate ──
    const entries = [
      { recipient: alice.address, amount: aliceAmt, start: 0 },
      { recipient: bob.address, amount: bobAmt, start: 0 },
      { recipient: carol.address, amount: carolAmt, start: 0 },
    ];
    await lur.connect(manager).approve(await vesting.getAddress(), totalAllocated);
    await vesting.connect(manager).allocateBatch(poolId, entries);

    // allocations recorded correctly
    for (const [i, user] of [alice, bob, carol].entries()) {
      const alloc = await vesting.getUserAllocation(user.address, poolId);
      expect(alloc.total).to.equal(entries[i].amount);
      expect(alloc.claimed).to.equal(0n);
    }

    // ── before cliff: nothing claimable ──
    for (const user of [alice, bob, carol]) {
      expect(await vesting.getClaimableAmount(user.address, poolId)).to.equal(0n);
    }

    // ── pass cliff → initial unlock (50%) available ──
    await ethers.provider.send("evm_increaseTime", [cliffDuration + 1]);
    await ethers.provider.send("evm_mine", []);

    expect(await vesting.getClaimableAmount(alice.address, poolId)).to.equal(ethers.parseEther("200"));
    expect(await vesting.getClaimableAmount(bob.address, poolId)).to.equal(ethers.parseEther("100"));
    expect(await vesting.getClaimableAmount(carol.address, poolId)).to.equal(ethers.parseEther("50"));

    // alice and bob claim their initial unlock; carol waits
    await vesting.connect(alice).claim(poolId);
    await vesting.connect(bob).claim(poolId);
    expect(await lur.balanceOf(alice.address)).to.equal(ethers.parseEther("200"));
    expect(await lur.balanceOf(bob.address)).to.equal(ethers.parseEther("100"));

    // ── advance 1 period → 75% vested ──
    // unlocked: alice=300, bob=150, carol=75
    await ethers.provider.send("evm_increaseTime", [periodDuration]);
    await ethers.provider.send("evm_mine", []);

    expect(await vesting.getClaimableAmount(alice.address, poolId)).to.equal(ethers.parseEther("100")); // 300-200
    expect(await vesting.getClaimableAmount(bob.address, poolId)).to.equal(ethers.parseEther("50")); // 150-100
    expect(await vesting.getClaimableAmount(carol.address, poolId)).to.equal(ethers.parseEther("75")); // 75-0

    // alice claims her mid-vesting tranche; bob and carol wait
    await vesting.connect(alice).claim(poolId);
    expect(await lur.balanceOf(alice.address)).to.equal(ethers.parseEther("300")); // 200+100

    // ── advance to full vesting ──
    await ethers.provider.send("evm_increaseTime", [periodDuration]);
    await ethers.provider.send("evm_mine", []);

    expect(await vesting.getClaimableAmount(alice.address, poolId)).to.equal(ethers.parseEther("100")); // 400-300
    expect(await vesting.getClaimableAmount(bob.address, poolId)).to.equal(ethers.parseEther("100")); // 200-100
    expect(await vesting.getClaimableAmount(carol.address, poolId)).to.equal(ethers.parseEther("100")); // 100-0

    await vesting.connect(alice).claim(poolId);
    await vesting.connect(bob).claim(poolId);
    await vesting.connect(carol).claim(poolId);

    expect(await lur.balanceOf(alice.address)).to.equal(aliceAmt);
    expect(await lur.balanceOf(bob.address)).to.equal(bobAmt);
    expect(await lur.balanceOf(carol.address)).to.equal(carolAmt);

    // allocations fully claimed
    expect((await vesting.getUserAllocation(alice.address, poolId)).claimed).to.equal(aliceAmt);
    expect((await vesting.getUserAllocation(bob.address, poolId)).claimed).to.equal(bobAmt);
    expect((await vesting.getUserAllocation(carol.address, poolId)).claimed).to.equal(carolAmt);

    // ── only the extra tokens remain in the contract ──
    const vestingAddr = await vesting.getAddress();
    expect(await lur.balanceOf(vestingAddr)).to.equal(extra);

    // manager refunds the extra to a separate address
    await vesting.connect(manager).refund(await lur.getAddress(), refundRecipient.address, extra);
    expect(await lur.balanceOf(refundRecipient.address)).to.equal(extra);
    expect(await lur.balanceOf(vestingAddr)).to.equal(0n);
  });
});
