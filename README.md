# Appendix: Indexing Setup

Apibara is the easiest way to build production-grade indexers:
-   **Stream**  onchain data into an indexer, receiving exactly the data that is needed.
-   **Transform**  the data into a higher-level representation that maps to an application domain.
-   **Integrate**  data with the rest of the application by sending it to other services.

## Apibara CLI Tools

Setting up Apibara CLI. The following commands are specific to a Mac
```
brew install jq
curl -sL https://install.apibara.com | bash
```
Check installation here
```
apibara --version
```
Lastly, developers can manage plugins in Apibara using commands like the ones below - 
```
apibara plugins list
apibara plugins install <plugin-name>
```
Moreover, developers also need to set up a project on the Apibara dashboard and obtain the corresponding API key. 

## Code Editor Extensions

Apibara indexers are powered by the Deno Javascript runtime. Deno can run JavaScript and TypeScript files with no additional tools or configuration required. 

In order to set up, this requires doing 2 things

- Instal the Runtime + CLI
- Setup the IDE with plugins

Deno comes with many of the tools that are commonly needed for developing applications, including a full [language server (LSP)](https://docs.deno.com/runtime/reference/cli/lsp/) to help power the IDE of choice.

Indexers dependencies are loaded from external CDNs like ESM. This is is a Deno-friendly _CDN_ (Content Delivery Network) that resolves Node's built-in modules (such as fs, os, etc.), making it compatible with Deno.

## Using Environment Variables

As with any `node.js` projects, environment variables are crucial to storing "secret" values properly and safely in a project. They can be stored in an `.env` file.

A Deno script can access any environment variable with the `Deno.env.get` function. This function returns the value of the environment variable or an undefined value if the variable is not set.

## Transforming The Data

Apibara allows users to transform the data from the Apibara stream using a simple Javascript function. 

A simple function for a token contract is as follows - 

```
export default function transform({ header, events }) {

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
      amount: amount,
      amount_raw: amountRaw.toString(),
    };
  });
}
```

## Making Fetch Requests

Simply streaming **Accepted** blocks from a Apibara can leave an app with stale information. As mentioned above, this is because the current state of a blockchain is an amalgamation of the state of the last **Accepted** block along with all pending transactions taken by the sequencer since then.

To reconcile this, Apibara allows developers to fetch block data through RPC calls, from a Starknet node such as [Juno](https://github.com/NethermindEth/juno). 

An example of this is the following -

```
export default async function transform(_block: unknown) {
  const response = await fetch("https://free-rpc.nethermind.io/sepolia-juno/", {
    method: "POST",
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "starknet_specVersion",
      params: [],
    }),
  });
  const { result } = await response.json();
  console.log(result);
  return [];
}
```

## Implementing the Indexer

Indexers are implemented as Javascript or Typescript scripts. Scripts need to export at least two things:

-   a  `config`  object that contains the indexer configuration.
-   a default function, used to transform each batch of data 

A minimal script looks like the following:

```
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
      amount: amount,
      amount_raw: amountRaw.toString(),
      spec_version: specVersion, // Added specVersion here
    };
  });
}

```
Developers can run it using the `apibara run` command. Notice Apibara provides a free API key to consume the hosted stream.
```
apibara run --allow-net=infura.com,free-rpc.nethermind.io --allow-env=<file_name.env>
script.js -A  dna_xxx
```
Note, this allows the specified node hosts (known by Apibara) to process incoming RPC invocations.

## Testing the Indexer

Apibara allows developers to test their indexer by:

-   Generating testing fixtures for using actual data
-   Automatically running indexers on the testing fixtures and checking the output with known reference values

This testing strategy is often called "snapshot testing". The idea is to generate snapshots of the test output and compare this value in successive test runs.

To generate a snapshot - run the following code 

```
apibara test transfers.js -A dna_xxx
``` 
The testing tool connects to the live DNA stream from Apibara, to create the test fixtures. The snapshots are generated in the current directory's `snapshots/` folder. The snapshot includes data only for one block.

More details on Starknet specific filters can be found on this [page](https://www.apibara.com/docs/networks/starknet/filter).

