import { ZERO_ADDRESS } from "@uma/common";
import { L1_ADDRESS_MAP } from "./consts";
import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, getChainId } = hre;
  const { deploy } = deployments;

  const { deployer } = await getNamedAccounts();

  const chainId = parseInt(await getChainId());

  // This address receives gas refunds on the L2 after messages are relayed. Currently
  // set to the Risk Labs relayer address. The deployer should change this if necessary.
  const l2RefundAddress = "0x428AB2BA90Eba0a4Be7aF34C9Ac451ab061AC010";

  await deploy("Arbitrum_Adapter", {
    from: deployer,
    log: true,
    skipIfAlreadyDeployed: true,
    args: [
      L1_ADDRESS_MAP[chainId].l1ArbitrumInbox,
      L1_ADDRESS_MAP[chainId].l1ERC20GatewayRouter,
      l2RefundAddress,
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
func.tags = ["ArbitrumAdapter", "mainnet"];
