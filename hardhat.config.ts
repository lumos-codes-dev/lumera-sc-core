import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@openzeppelin/hardhat-upgrades";
import dotenv from "dotenv";

dotenv.config();

const PRIVATE_KEYS = process.env.PRIVATE_KEY ? process.env.PRIVATE_KEY.split(",") : [];
const MAINNET_RPC_URL = process.env.MAINNET_RPC_URL || "https://ethereum-rpc.publicnode.com";
const BASE_RPC_URL = process.env.BASE_RPC_URL || "https://mainnet.base.org";
const SEPOLIA_RPC_URL = process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY || "";
const BASESCAN_API_KEY = process.env.BASESCAN_API_KEY || "";
const COINMARKETCAP_API_KEY = process.env.COINMARKETCAP_API_KEY || "";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      evmVersion: "cancun",
    },
  },

  networks: {
    hardhat: {},
    ethereum: {
      url: MAINNET_RPC_URL,
      accounts: PRIVATE_KEYS,
    },
    sepolia: {
      url: SEPOLIA_RPC_URL,
      accounts: PRIVATE_KEYS,
    },
    base: {
      url: BASE_RPC_URL,
      accounts: PRIVATE_KEYS,
    },
  },

  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY || "",
  },
  gasReporter: {
    enabled: true,
    currency: "USD",
    coinmarketcap: COINMARKETCAP_API_KEY,
  },
};

export default config;
