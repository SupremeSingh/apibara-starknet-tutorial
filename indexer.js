import { hash, uint256 } from "https://esm.run/starknet@5.14";
import { formatUnits } from "https://esm.run/viem@1.4";

const DECIMALS = Number(Deno.env.get('TOKEN_DECIMALS')) ?? 18;

export const config = {
  streamUrl: "https://sepolia.starknet.a5a.ch",
  startingBlock: Number(Deno.env.get('STARTING_BLOCK')) ?? 200000,
  network: "starknet",
  finality: "DATA_STATUS_PENDING",
  filter: {
    header: { weak: true },
    events: [
      {
        fromAddress:
          "0x049D36570D4e46f48e99674bd3fcc84644DdD6b96F7C741B1562B82f9e004dC7",
        keys: [hash.getSelectorFromName("Transfer")],
        includeReceipt: true,
      },
    ],
  },
  sinkType: "console",
  sinkOptions: {
    tableName: "transfers",
  },
};

export default async function transform({ header, events }) {
  // Fetch Starknet spec version
  const response = await fetch("https://free-rpc.nethermind.io/sepolia-juno/", {
    method: "POST",
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "starknet_specVersion",
      params: [],
    }),
  });
  const { result: specVersion } = await response.json();

  const { blockNumber, blockHash, timestamp } = header;
  
  return events.map(({ event, receipt }) => {
    const { transactionHash } = receipt;
    const transferId = `${transactionHash}_${event.index}`;

    const [fromAddress, toAddress, amountLow, amountHigh] = event.data;
    const amountRaw = uint256.uint256ToBN({ low: amountLow, high: amountHigh });
    const amount = formatUnits(amountRaw, DECIMALS);

    // Convert to snake_case because it works better with postgres.
    return {
      network: "starknet-sepolia",
      symbol: "ETH",
      block_hash: blockHash,
      block_number: +blockNumber,
      block_timestamp: timestamp,
      transaction_hash: transactionHash,
      transfer_id: transferId,
      from_address: fromAddress,
      to_address: toAddress,
      amount: +amount,
      amount_raw: amountRaw.toString(),
      spec_version: specVersion, // Added specVersion here
    };
  });
}
