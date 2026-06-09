import { expect } from "chai";
const { ethers } = require("hardhat");

describe("LURToken", function () {
  it("deploys, mints initial supply and supports basic ERC20 behavior", async function () {
    const [owner, alice] = await ethers.getSigners();

    const initialSupply = ethers.parseEther("1000");
    const LUR = await ethers.getContractFactory("LURToken");
    const lur = await LUR.deploy(owner.address, initialSupply);
    await lur.waitForDeployment();

    expect(await lur.name()).to.equal("LUR Token");
    expect(await lur.symbol()).to.equal("LUR");
    expect(await lur.balanceOf(owner.address)).to.equal(initialSupply);

    await (await lur.transfer(alice.address, ethers.parseEther("10"))).wait();
    expect(await lur.balanceOf(alice.address)).to.equal(ethers.parseEther("10"));

    expect(await lur.nonces(owner.address)).to.equal(BigInt(0));
    const clk = await lur.clock();
    expect(typeof clk).to.equal("bigint");
    expect(await lur.CLOCK_MODE()).to.equal("mode=timestamp");
  });
});
