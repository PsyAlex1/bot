import { FlashbotsBundleProvider } from "@flashbots/ethers-provider-bundle";
import { ethers } from "ethers";
import fetch from "node-fetch";
import fs from "fs";
import dotenv from "dotenv";
import TelegramBot from "node-telegram-bot-api";
import ABI from "./abis/liquidationbot.json" assert { type: "json" };

dotenv.config();

const AAVE_SUBGRAPH = "https://api.thegraph.com/subgraphs/name/aave/protocol-v3-polygon";
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const RPC_URL = process.env.RPC_URL;
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI.abi, wallet);
const botTelegram = new TelegramBot(TELEGRAM_TOKEN, { polling: false });

function sendTelegramMessage(message) {
    if (TELEGRAM_TOKEN && TELEGRAM_CHAT_ID) {
        botTelegram.sendMessage(TELEGRAM_CHAT_ID, message).catch(err => console.error("Telegram error:", err));
    } else {
        console.warn("Telegram not configured.");
    }
}

function logLiquidation(entry) {
    const logFile = "logs/liquidations.json";
    const existing = fs.existsSync(logFile) ? JSON.parse(fs.readFileSync(logFile)) : [];
    existing.push(entry);
    fs.writeFileSync(logFile, JSON.stringify(existing, null, 2));
}

async function checkLiquidations() {
    const query = `{
        users(where: { healthFactor_lt: "1" }) {
            id
            healthFactor
            collateralReserve { reserve { id } }
            variableDebt { reserve { id } currentTotalDebt }
        }
    }`;

    const res = await fetch(AAVE_SUBGRAPH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query })
    });

    const json = await res.json();
    return json.data.users;
}

async function runLiquidation() {
    const opportunities = await checkLiquidations();
    if (!opportunities.length) {
        console.log("No liquidation opportunities.");
        return;
    }

    opportunities.sort((a, b) => parseFloat(b.variableDebt[0].currentTotalDebt) - parseFloat(a.variableDebt[0].currentTotalDebt));

    for (const user of opportunities) {
        const userAddress = user.id;
        const debtAsset = user.variableDebt[0].reserve.id;
        const collateralAsset = user.collateralReserve[0].reserve.id;
        const amountToRepay = user.variableDebt[0].currentTotalDebt;

        try {
            const tx = await contract.populateTransaction.initiateFlashLoan(
                debtAsset,
                amountToRepay,
                userAddress,
                debtAsset,
                collateralAsset,
                false
            );

            const flashbotsProvider = await FlashbotsBundleProvider.create(provider, wallet);
            const signedTx = await wallet.signTransaction({
                to: tx.to,
                data: tx.data,
                gasLimit: 1_000_000,
                gasPrice: ethers.utils.parseUnits("50", "gwei"),
                nonce: await provider.getTransactionCount(wallet.address),
                chainId: 137
            });

            const bundle = [{ signedTransaction: signedTx }];
            const targetBlock = (await provider.getBlockNumber()) + 1;
            const res = await flashbotsProvider.sendBundle(bundle, targetBlock);

            if (res.error) {
                console.error("Flashbots error:", res.error.message);
            } else {
                const entry = {
                    timestamp: new Date().toISOString(),
                    userAddress,
                    amountToRepay,
                    debtAsset,
                    collateralAsset
                };
                logLiquidation(entry);
                sendTelegramMessage(`✅ Liquidation OK\n👤 User: ${userAddress}\n💰 Amount: ${amountToRepay}`);
                console.log("Liquidation bundle sent:", entry);
            }
        } catch (error) {
            console.error(`Error liquidating user ${userAddress}:`, error);
        }
    }
}

setInterval(runLiquidation, 15000);