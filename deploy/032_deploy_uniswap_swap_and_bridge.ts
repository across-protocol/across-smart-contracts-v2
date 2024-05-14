import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { TOKEN_SYMBOLS_MAP } from "@across-protocol/constants-v2";

import { getDeployedAddress } from "../src/DeploymentUtils";
import { L2_ADDRESS_MAP } from "./consts";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { getChainId, deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;

  const chainId = parseInt(await getChainId());
  const { deployer } = await getNamedAccounts();

  await deploy("UniswapV3_SwapAndBridge", {
    contract: "SwapAndBridge",
    from: deployer,
    log: true,
    skipIfAlreadyDeployed: true,
    args: [
      getDeployedAddress("SpokePool", chainId),
      L2_ADDRESS_MAP[chainId].uniswapV3SwapRouter,
      // Function selector for `exactInputSingle` method in Uniswap V3 SwapRouter
      // https://etherscan.io/address/0xE592427A0AEce92De3Edee1F18E0157C05861564#writeProxyContract#F2
      ["0x414bf389"],
      TOKEN_SYMBOLS_MAP[chainId === 8453 ? "USDbC" : "USDC.e"].addresses[chainId],
      TOKEN_SYMBOLS_MAP._USDC.addresses[chainId],
    ],
  });
};
module.exports = func;
func.tags = ["UniswapV3_SwapAndBridge", "SwapAndBridge", "uniswapV3"];
