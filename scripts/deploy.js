import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with the account:", deployer.address);

  const provider = "0xa97684ead0e402dc232d5a977953df7ecbab3cdb"; // Aave Polygon PoolAddressesProvider
  const swapRouter = "0xE592427A0AEce92De3Edee1F18E0157C05861564"; // Uniswap V3 Swap Router on Polygon

  const LiquidationBot = await ethers.getContractFactory("LiquidationBot");
  const bot = await LiquidationBot.deploy(provider, swapRouter);
  await bot.deployed();

  console.log("LiquidationBot deployed to:", bot.address);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
