import { ethers, upgrades } from "hardhat";
import hre from "hardhat";

const STAKING_PROXY_SEPOLIA = "0xB99a627e78C96aa323496eF250E6ca87B13c65a5";
const VERIFY_DELAY_MS = Number(process.env.VERIFY_DELAY_MS ?? 30_000);
const FORCE_REDEPLOY_IMPL = true;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function verifyImplementation(address: string): Promise<void> {
  try {
    await hre.run("verify:verify", {
      address,
      constructorArguments: [],
    });
    console.log(`  ok  Implementation verified: ${address}`);
  } catch (err: any) {
    const msg: string = err?.message ?? String(err);
    if (msg.toLowerCase().includes("already verified")) {
      console.log(`  ok  Implementation already verified: ${address}`);
      return;
    }
    console.warn(`  warn  Implementation verification failed for ${address}:\n    ${msg}`);
  }
}

async function main(): Promise<void> {
  console.log("=== LURStaking Upgrade (Sepolia) ===\n");

  const [deployer] = await ethers.getSigners();
  console.log("Network   :", hre.network.name);
  console.log("Deployer  :", deployer.address);
  console.log("Proxy     :", STAKING_PROXY_SEPOLIA);
  console.log("Balance   :", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH\n");

  const LURStakingFactory = await ethers.getContractFactory("LURStaking");
  await upgrades.forceImport(STAKING_PROXY_SEPOLIA, LURStakingFactory, { kind: "uups" });

  const implementationBefore = await upgrades.erc1967.getImplementationAddress(STAKING_PROXY_SEPOLIA);
  console.log("Current impl:", implementationBefore);

  console.log("Validating upgrade safety...");
  await upgrades.validateUpgrade(STAKING_PROXY_SEPOLIA, LURStakingFactory, {
    kind: "uups",
  });

  console.log("Deploying target implementation...");
  const targetImplementation = await upgrades.deployImplementation(LURStakingFactory, {
    kind: "uups",
    redeployImplementation: FORCE_REDEPLOY_IMPL ? "always" : "onchange",
  });
  console.log("Target impl:", targetImplementation);

  const stakingProxy = await ethers.getContractAt("LURStaking", STAKING_PROXY_SEPOLIA);

  if (targetImplementation === implementationBefore) {
    console.log("  info Target implementation equals current implementation; no proxy switch required.");
  } else {
    console.log("Upgrading proxy to target implementation...");
    const upgradeTx = await (stakingProxy as any).upgradeToAndCall(targetImplementation, "0x");
    await upgradeTx.wait();
  }

  const proxyAddress = await stakingProxy.getAddress();
  const implementationAddress = await upgrades.erc1967.getImplementationAddress(proxyAddress);

  console.log("  ok  Proxy upgraded");
  console.log("  Proxy :", proxyAddress);
  console.log("  Impl before:", implementationBefore);
  console.log("  Impl  :", implementationAddress);

  if (implementationAddress === implementationBefore) {
    console.log(
      "  info Implementation unchanged. This is expected when contract bytecode did not change." +
        " Set FORCE_REDEPLOY_IMPL=true to force a new implementation deployment."
    );
  } else {
    console.log("  ok  Implementation switched successfully.");
  }

  if (VERIFY_DELAY_MS > 0) {
    console.log(`\nWaiting ${VERIFY_DELAY_MS / 1000}s before verification...`);
    await sleep(VERIFY_DELAY_MS);
  }

  console.log("\nVerifying implementation on Etherscan...");
  await verifyImplementation(implementationAddress);

  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
