# Token Terminal Blockchain Indexing Task

In this task, you will implement a simplified version of the Token Terminal ELT process.
This assignment assumes some knowledge of blockchain, but no in-depth knowledge of the scraped data is required.

We expect you to complete this task in your own time. All required software can be used free of charge.

Please keep the code readable and add comments where relevant. If you encounter any issues, feel free to be creative or contact us for help. If you make any assumptions, please note them in the comments.

We don't expect you to spend more than 2-3 hours of active time on this task. Please note that syncing the node may take a while, depending on your internet speed. Start the node well before you begin working on the task to avoid waiting for the node to boot up.
With my mac, it took about 30 minutes to sync the node.

You can keep the solutions as simple as possible, and it's okay if you don't have time to complete the entire task. We understand it can be intense.

## Instructions

1. Fork this repository or create a private clone of it.
2. Develop the indexer and commit the code.
3. Write SQL queries or create table/view commands and save them into one or more SQL files, which you should commit to the repository.
4. Push the code to GitHub. If you prefer to keep the repository private, invite `jamo` as a reader, or alternatively, send it as a zip file.

## Goals:

1. Build a dataset in our data warehouse with two tables:

   1. blocks
   2. transactions

2. Analytics
   1. Standardized transaction model & QA

## Steps:

1. Set up a blockchain node.
2. Implement a lightweight, simple indexer to extract raw data from the chain.
3. Load the data into the data warehouse.
4. Implement the data model and a Trending contracts dataset.

#### SQL Style Guide

When writing SQL, please keep the following key points in mind:

1. Keep the SQL readable. Avoid short table names and acronyms.
   - Don't use `from raw.blocks as b`, but use `blocks` as the table name.
2. Use CTEs over subqueries. CTEs keep the SQL readable; only use subqueries when absolutely necessary.
3. We use dbt to manage dependencies, but to avoid scope creep, we won't install and set up dbt here.
   - Save a couple of SQL queries as tables, or create the required views and tables manually.
   - Use numbers in the filenames to describe the file dependencies, e.g., `0001_init_tables.sql`, `0002_blocks.sql`, and so on.

#### System Requirements

- Linux or Mac. This has not been tested on Windows, but it might still work.
- Docker, which we assume you have installed already.
- Nodejs/typescript, you can use nvm or brew to install.
- Clickhouse: no installation required; see below for the single step to get the binary.

### 1. Running the Blockchain Node

For this task, we'll set up and run the Linea Sepolia node. The node is a generic `geth` node (geth is a classic EVM node client), and their testnet Sepolia is nice and small.
This allows us to dive into the data quickly without massive disk space requirements.

You should have ~100GB of free disk space for this task.

In this repo, we have provided a ready-made `docker-compose` file for running the node. This is rarely the case, but the goal is not to test your ability to Google arbitrary configuration flags.

#### Setting up the node

We use snap sync to quickly download the latest blockchain state without the full history. This method is efficient and reduces time and storage needs. Not using archival mode further optimizes the process for querying recent data.

To do it, go to `./linea` and use `docker compose up -d`.

Use `docker logs linea-node-1` to view the logs. Once the node logs `Imported new chain segment` it should be catching up and ready to query.
With the snap sync method, the node has to complete the download to let us properly query the blockchain.

You can view the docker logs to see the progress. It logs the synced status and the ETA.
For example:

```
INFO [01-15|17:14:45.081] Syncing: chain download in progress      synced=3.27%   chain=151.87MiB headers=305,152@82.02MiB bodies=271,587@61.44MiB receipts=271,587@8.42MiB eta=47m45.166s
```

To see the latest available block, you may use the following query:

```
curl 127.0.0.1:8545 -X POST -H "Content-Type: application/json" -d '{"jsonrpc":"2.0", "method": "eth_getBlockByNumber", "params": ["latest", false], "id": "x"}' | jq .
```

To get the block number in plain text:

```
curl 127.0.0.1:8545 -X POST -H "Content-Type: application/json" -d '{"jsonrpc":"2.0", "method": "eth_getBlockByNumber", "params": ["latest", false], "id": "x"}' | jq .result.number -r | xargs printf "%d\n"
```

When updating this task, the latest block is 8 297 638.

For more information on running Linea, see their docs: https://docs.linea.build/developers/guides/run-a-node/use-docker. Note that we are using the `geth` client in this task.

### 2. Implementing the Indexer

In this phase, we will write code to extract blockchain data and prepare it for loading into our data warehouse. We will use the [JSON RPC API](https://openethereum.github.io/JSONRPC-eth-module) provided by the blockchain node for data indexing.

Create a program that uses `START` and `COUNT` parameters from the environment to scrape data from `START` to `START+COUNT`. The program should generate one or more files for loading into Clickhouse. For simplicity, we recommend you to use the json-newline format.

This repository includes helpful functions and example schemas to assist you. We have provided convenience functions to facilitate interaction with the blockchain.

Following the ELT approach, we aim to minimize data transformations during loading. However, two transformations are necessary for ease of use. Further data manipulation can occur in the data warehouse.

- Convert blockNumber and timestamp to a human-readable format and include them in all data entries (receipts, traces).
- [Optional] Extract transactions into a separate file for simplicity. However the proviced SQL examples assume you've done it.

For this task, scrape approximately last couple of weeks of data.

Below are the relevant JSON RPC methods and their documentation links. You may not need to consult the documentation to complete this task.

- Blocks
  - `eth_getBlockByNumber`
  - [Documentation](https://openethereum.github.io/JSONRPC-eth-module#eth_getblockbynumber)
  - This method can also return full transaction data if the second parameter is set to true. We used this query to verify the node's status.
- Transaction Receipts
  - `eth_getBlockReceipts`
  - [Documentation](https://www.quicknode.com/docs/ethereum/eth_getBlockReceipts)
  - This method returns transaction receipts, which need to be linked to transactions for analytics purposes, following the ELT workflow.

Tips:

- To simplify the workflow, save the files in the Clickhouse `user_files` directory: `db/user_files`.

### 3. Loading Data into Clickhouse

#### Setting Up Clickhouse Locally

Setting up Clickhouse is straightforward, which is why we use it for this task.

Run the clickhouse related commands in the `./db` folder.

Get the latest binary:

```
curl https://clickhouse.com/ | sh
```

And start up the clickhouse local server:

```
./clickhouse server
```

Leave this running in its own terminal tab.

#### Test the Clickhouse cli connection

`./clickhouse client`

#### Load data

To make loading the data easier, we have provided example queries to create the `blocks`, `transactions`, `receipts` tables. You can use these as a starting point.
Depending on your implementation, you might have transactiosn data nested in the blocks, or in a separate file.

See `./sql` folder for examples of the schema and import queries.

These assume you have saved the data with similar modifications, so you may need to make minor edits.

You can use clickhouse to infer the schema from the files: e.g., `describe table file('./blocks_*') FORMAT JSONCompactEachRow;`
Note: The path for `file` is relative to the `./db/user_files`

### 4. Analytics

#### Available Data Sources

After the above steps, you have the following raw tables are available in the data warehouse:

- `raw.blocks` - Contains block-level blockchain data
- `raw.transactions` - Contains individual transaction data unnested from inside the raw blocks.
- `raw.receipts` - Contains transaction receipt data with execution results

#### Tasks

1. **Transaction Analytics Model**

   - Create `transactions.sql` that combines data from the raw tables
   - Model should enable calculation of:
     - Transaction fees
     - Number of active users (transaction senders)
     - Fee paid to an underlying L1 blockchain
   - Save as a view or materialized table
   - Follow the SQL style guide outlined above

2. **Data Quality Validation**
   - Create a QA model to verify data completeness
   - Implement checks for:
     - Continuous block sequence (no gaps)
     - Complete data for specified date range
     - Expected number of transactions per block
   - Save queries in a separate SQL file (e.g., `qa_checks.sql`)

#### Expected Deliverables

- SQL files following the naming convention: `0003_transactions.sql`, `0004_qa_checks.sql`
- Each file should be self-contained and documented
- Include any assumptions made in SQL comments
