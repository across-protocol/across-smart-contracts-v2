import { DeployFunction } from "hardhat-deploy/types";
import { deployNewProxy, getSpokePoolDeploymentInfo } from "../utils/utils.hre";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { hubPool } = await getSpokePoolDeploymentInfo(hre);

  // Initialize deposit counter to very high number of deposits to avoid duplicate deposit ID's
  // with deprecated spoke pool.
  // Set hub pool as cross domain admin since it delegatecalls the Adapter logic.
  const initArgs = [1_000_000, hubPool.address, hubPool.address];
  await deployNewProxy("Boba_SpokePool", initArgs, {
    constructorArgs: ["0xDeadDeAddeAddEAddeadDEaDDEAdDeaDDeAD0000", 3600, 32400],
  });
};
module.exports = func;
func.tags = ["BobaSpokePool", "boba"];
