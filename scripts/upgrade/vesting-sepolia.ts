import { ethers, upgrades } from "hardhat";
import hre from "hardhat";

const VESTING_PROXY_SEPOLIA = "0x5258354a32324bdee0b6f1232ee03ba7bb1f64f4";
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
  console.log("Proxy     :", VESTING_PROXY_SEPOLIA);
  console.log("Balance   :", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH\n");

  const VESTINGFactory = await ethers.getContractFactory("LURVesting");
  await upgrades.forceImport(VESTING_PROXY_SEPOLIA, VESTINGFactory, { kind: "uups" });

  const implementationBefore = await upgrades.erc1967.getImplementationAddress(VESTING_PROXY_SEPOLIA);
  console.log("Current impl:", implementationBefore);

  console.log("Validating upgrade safety...");
  await upgrades.validateUpgrade(VESTING_PROXY_SEPOLIA, VESTINGFactory, {
    kind: "uups",
  });

  console.log("Deploying target implementation...");
  const targetImplementation = await upgrades.deployImplementation(VESTINGFactory, {
    kind: "uups",
    redeployImplementation: FORCE_REDEPLOY_IMPL ? "always" : "onchange",
  });
  console.log("Target impl:", targetImplementation);

  const vestingProxy = await ethers.getContractAt("LURVesting", VESTING_PROXY_SEPOLIA);

  if (targetImplementation === implementationBefore) {
    console.log("  info Target implementation equals current implementation; no proxy switch required.");
  } else {
    console.log("Upgrading proxy to target implementation...");
    const upgradeTx = await (vestingProxy as any).upgradeToAndCall(targetImplementation, "0x");
    await upgradeTx.wait();
  }

  const proxyAddress = await vestingProxy.getAddress();
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
