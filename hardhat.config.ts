import * as dotenv from "dotenv";

import { HardhatUserConfig } from "hardhat/config";
import { getNodeUrl, getMnemonic } from "@uma/common";

import "@nomicfoundation/hardhat-verify"; // Must be above hardhat-upgrades
import "@nomiclabs/hardhat-waffle";
import "@typechain/hardhat";
import "@matterlabs/hardhat-zksync-solc";
import "@matterlabs/hardhat-zksync-verify";
import "@matterlabs/hardhat-zksync-upgradable";
import "hardhat-gas-reporter";
import "solidity-coverage";
import "hardhat-deploy";
import "@openzeppelin/hardhat-upgrades";

// Custom tasks to add to HRE.
// eslint-disable-next-line node/no-missing-require
require("./tasks/enableL1TokenAcrossEcosystem");

dotenv.config();

// To compile with zksolc, `hardhat` must be the default network and its `zksync` property must be true.
// So we allow the caller to set this environment variable to toggle compiling zk contracts or not.
// TODO: Figure out way to only compile specific contracts intended to be deployed on ZkSync (e.g. ZkSync_SpokePool) if
// the following config is true.
const compileZk = process.env.COMPILE_ZK === "true";

const solcVersion = "0.8.18";
const mnemonic = getMnemonic();

// Compilation settings are overridden for large contracts to allow them to compile without going over the bytecode
// limit.
const LARGE_CONTRACT_COMPILER_SETTINGS = {
  version: solcVersion,
  settings: { optimizer: { enabled: true, runs: 200 }, viaIR: true },
};

const config: HardhatUserConfig = {
  solidity: {
    compilers: [{ version: solcVersion, settings: { optimizer: { enabled: true, runs: 1000000 }, viaIR: true } }],
    overrides: {
      "contracts/HubPool.sol": LARGE_CONTRACT_COMPILER_SETTINGS,
      "contracts/Boba_SpokePool.sol": LARGE_CONTRACT_COMPILER_SETTINGS,
      "contracts/Optimism_SpokePool.sol": LARGE_CONTRACT_COMPILER_SETTINGS,
      "contracts/test/MockSpokePoolV2.sol": LARGE_CONTRACT_COMPILER_SETTINGS,
      "contracts/test/MockOptimism_SpokePool.sol": LARGE_CONTRACT_COMPILER_SETTINGS,
    },
  },
  zksolc: {
    version: "latest",
    settings: {
      optimizer: {
        enabled: true,
      },
    },
  },
  networks: {
    hardhat: { accounts: { accountsBalance: "1000000000000000000000000" }, zksync: compileZk },
    mainnet: {
      url: getNodeUrl("mainnet", true, 1),
      accounts: { mnemonic },
      saveDeployments: true,
      chainId: 1,
    },
    "zksync-goerli": {
      chainId: 280,
      url: "https://testnet.era.zksync.dev",
      saveDeployments: true,
      accounts: { mnemonic },
      companionNetworks: { l1: "goerli" },
      zksync: true,
      verifyURL: "https://zksync2-testnet-explorer.zksync.dev/contract_verification",
    },
    zksync: {
      chainId: 324,
      url: "https://mainnet.era.zksync.io",
      saveDeployments: true,
      accounts: { mnemonic },
      companionNetworks: { l1: "mainnet" },
      zksync: true,
      verifyURL: "https://zksync2-mainnet-explorer.zksync.io/contract_verification",
    },
    kovan: {
      url: getNodeUrl("kovan", true, 42),
      accounts: { mnemonic },
      saveDeployments: true,
      chainId: 42,
    },
    "optimism-kovan": {
      url: getNodeUrl("optimism-kovan", true, 69),
      accounts: { mnemonic },
      saveDeployments: true,
      chainId: 69,
      companionNetworks: { l1: "kovan" },
    },
    optimism: {
      url: getNodeUrl("optimism", true, 10),
      accounts: { mnemonic },
      saveDeployments: true,
      chainId: 10,
      companionNetworks: { l1: "mainnet" },
    },
    arbitrum: {
      chainId: 42161,
      url: getNodeUrl("arbitrum", true, 42161),
      saveDeployments: true,
      accounts: { mnemonic },
      companionNetworks: { l1: "mainnet" },
    },
    "arbitrum-rinkeby": {
      chainId: 421611,
      url: getNodeUrl("arbitrum-rinkeby", true, 421611),
      saveDeployments: true,
      accounts: { mnemonic },
      companionNetworks: { l1: "rinkeby" },
    },
    "arbitrum-goerli": {
      chainId: 421613,
      url: "https://goerli-rollup.arbitrum.io/rpc",
      saveDeployments: true,
      accounts: { mnemonic },
      companionNetworks: { l1: "goerli" },
    },
    rinkeby: {
      chainId: 4,
      url: getNodeUrl("rinkeby", true, 4),
      saveDeployments: true,
      accounts: { mnemonic },
    },
    goerli: {
      chainId: 5,
      url: getNodeUrl("goerli", true, 5),
      saveDeployments: true,
      accounts: { mnemonic },
    },
    sepolia: {
      url: "https://rpc2.sepolia.org",
      accounts: { mnemonic },
      saveDeployments: true,
      chainId: 11155111,
    },
    polygon: {
      chainId: 137,
      url: getNodeUrl("polygon-matic", true, 137),
      saveDeployments: true,
      accounts: { mnemonic },
      companionNetworks: { l1: "mainnet" },
    },
    boba: {
      chainId: 288,
      url: getNodeUrl("boba", true, 288),
      accounts: { mnemonic },
      companionNetworks: { l1: "mainnet" },
    },
    "polygon-mumbai": {
      chainId: 80001,
      url: getNodeUrl("polygon-mumbai", true, 80001),
      saveDeployments: true,
      accounts: { mnemonic },
      companionNetworks: { l1: "goerli" },
    },
  },
  gasReporter: { enabled: process.env.REPORT_GAS !== undefined, currency: "USD" },
  etherscan: {
    apiKey: {
      mainnet: process.env.ETHERSCAN_API_KEY!,
      kovan: process.env.ETHERSCAN_API_KEY!,
      rinkeby: process.env.ETHERSCAN_API_KEY!,
      goerli: process.env.ETHERSCAN_API_KEY!,
      sepolia: process.env.ETHERSCAN_API_KEY!,
      optimisticEthereum: process.env.OPTIMISM_ETHERSCAN_API_KEY!,
      arbitrumOne: process.env.ARBITRUM_ETHERSCAN_API_KEY!,
      polygon: process.env.POLYGON_ETHERSCAN_API_KEY!,
      polygonMumbai: process.env.POLYGON_ETHERSCAN_API_KEY!,
    },
    customChains: [],
  },
  namedAccounts: { deployer: 0 },
  typechain: {
    outDir: "./typechain",
    target: "ethers-v5",
  },
};

export default config;
