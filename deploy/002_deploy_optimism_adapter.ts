import { ZERO_ADDRESS } from "@uma/common";
import { L1_ADDRESS_MAP } from "./consts";
import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, getChainId } = hre;
  const { deploy } = deployments;

  const { deployer } = await getNamedAccounts();

  const chainId = parseInt(await getChainId());

  await deploy("Optimism_Adapter", {
    from: deployer,
    log: true,
    skipIfAlreadyDeployed: true,
    args: [
      L1_ADDRESS_MAP[chainId].weth,
      L1_ADDRESS_MAP[chainId].optimismCrossDomainMessenger,
      L1_ADDRESS_MAP[chainId].optimismStandardBridge,
      L1_ADDRESS_MAP[chainId].usdc,
      // L1_ADDRESS_MAP[chainId].cctpTokenMessenger,
      // For now, we are not using the CCTP bridge and can disable by setting
      // the cctpTokenMessenger to the zero address.
      ZERO_ADDRESS,
    ],
  });
};

module.exports = func;
func.dependencies = ["HubPool"];
func.tags = ["OptimismAdapter", "mainnet"];
