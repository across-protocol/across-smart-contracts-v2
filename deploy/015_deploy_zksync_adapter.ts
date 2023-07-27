import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { L1_ADDRESS_MAP } from "./consts";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, getChainId } = hre;

  const { deploy } = deployments;

  const { deployer } = await getNamedAccounts();
  const chainId = parseInt(await getChainId());

  await deploy("ZkSync_Adapter", {
    from: deployer,
    log: true,
    skipIfAlreadyDeployed: true,
    // Most common across dataworker set as the refund address, but changeable by whoever runs the script.
    args: [L1_ADDRESS_MAP[chainId].weth, "0x428AB2BA90Eba0a4Be7aF34C9Ac451ab061AC010"],
  });
};

module.exports = func;
func.tags = ["ZkSyncAdapter", "mainnet"];
