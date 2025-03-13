import { toWei } from "../utils/utils";
import { L1_ADDRESS_MAP, USDC } from "./consts";
import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const chainId = parseInt(await hre.getChainId());

  // This address receives gas refunds on the L2 after messages are relayed. Currently
  // set to the Risk Labs relayer address. The deployer should change this if necessary.
  const l2RefundAddress = "0x07aE8551Be970cB1cCa11Dd7a11F47Ae82e70E67";

  // id that uniquely identifies a chain adapter type. Set to closely match chain ids
  const adapterId = 42161;
  // 1 ether is a good default for oftFeeCap for cross-chain OFT sends
  const oftFeeCap = toWei("1");

  const args = [
    L1_ADDRESS_MAP[chainId].l1ArbitrumInbox,
    L1_ADDRESS_MAP[chainId].l1ERC20GatewayRouter,
    l2RefundAddress,
    USDC[chainId],
    L1_ADDRESS_MAP[chainId].cctpTokenMessenger,
    adapterId,
    L1_ADDRESS_MAP[chainId].addressBook,
    oftFeeCap,
  ];
  const instance = await hre.deployments.deploy("Arbitrum_Adapter", {
    from: deployer,
    log: true,
    skipIfAlreadyDeployed: false,
    args: [
      L1_ADDRESS_MAP[chainId].l1ArbitrumInbox,
      L1_ADDRESS_MAP[chainId].l1ERC20GatewayRouter,
      l2RefundAddress,
      USDC[chainId],
      L1_ADDRESS_MAP[chainId].cctpTokenMessenger,
      adapterId,
      L1_ADDRESS_MAP[chainId].addressBook,
      oftFeeCap,
    ],
  });
  await hre.run("verify:verify", { address: instance.address, constructorArguments: args });
};

module.exports = func;
func.tags = ["ArbitrumAdapter", "mainnet"];
