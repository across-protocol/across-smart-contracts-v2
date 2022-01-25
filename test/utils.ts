import { getBytecode, getAbi } from "@uma/contracts-node";

import { ethers } from "hardhat";
import { BigNumber, Signer } from "ethers";

export async function getContractFactory(name: string, signer: any) {
  try {
    // Try fetch from the local ethers factory from HRE. If this exists then the contract is in this package.
    return await ethers.getContractFactory(name);
  } catch (error) {}
  // If it does not exist then try find the contract in the UMA core package.
  return new ethers.ContractFactory(getAbi(name as any), getBytecode(name as any), signer);
}

export const toWei = (num: string | number | BigNumber) => ethers.utils.parseEther(num.toString());

export const fromWei = (num: string | number | BigNumber) => ethers.utils.formatUnits(num.toString());

export const toBN = (num: string | number | BigNumber) => {
  // If the string version of the num contains a `.` then it is a number which needs to be parsed to a string int.
  if (num.toString().includes(".")) return BigNumber.from(parseInt(num as any));
  return BigNumber.from(num.toString());
};

export interface SignerWithAddress extends Signer {
  address: string;
}
