# Token Terminal Blockchain Indexing Task

In this task, you will implement a simplified version of the Token Terminal ELT process.
This assignment assumes some knowledge of blockchain, but no in-depth knowledge of the scraped data is required.

**Note on AI Usage**: We assume and encourage you to use AI coding assistants (GitHub Copilot, ChatGPT, Claude, etc.) to help you complete this assignment. This reflects modern development practices. We're interested in your ability to architect solutions, make technical decisions, and understand the systems you build—not just your ability to write code from scratch.

We expect you to complete this task in your own time. All required software can be used free of charge.

Please keep the code readable and add comments where relevant. If you encounter any issues, feel free to be creative or contact us for help. If you make any assumptions, please note them in the comments.

We don't expect you to spend more than 2-3 hours of active time on this task.

You can keep the solutions as simple as possible, and it's okay if you don't have time to complete the entire task. We understand it can be intense.

## Instructions

1. Fork this repository or create a private clone of it.
2. Develop the indexer and commit the code.
3. Write SQL queries or create table/view commands and save them into one or more SQL files, which you should commit to the repository.
4. Push the code to GitHub. If you prefer to keep the repository private, invite `jamo` as a reader, or alternatively, send it as a zip file.

## Blockchain RPC Options

You have **flexibility in choosing your blockchain and RPC endpoint**:

### Option 1: Anvil
We provide an Anvil-based local RPC node that starts instantly and supports standard `eth_*` JSON-RPC methods.

### Option 2: Your Own Chain/RPC
Alternatively, you can:
- Run your own blockchain node (Ethereum mainnet, Polygon, Arbitrum, etc.)
- Use public RPC endpoints (Infura, Alchemy, QuickNode, etc.)
- Use any EVM-compatible chain with standard JSON-RPC methods

**Please document which chain/RPC you chose in your submission.**

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
- Nodejs/typescript/go
- PostgreSQL: runs in Docker (see docker-compose.yml)

### 1. Running the Blockchain Node (Optional - Anvil)

**Note**: This step is optional if you're using a public RPC endpoint or your own node.

For this task, we provide a ready-made Anvil setup in `./anvil/`. It starts instantly and exposes JSON-RPC on `http://localhost:8545`.

#### Setting up the node

To do it, go to `./anvil` and run `docker-compose up -d`.

#### RPC Endpoint

Connect your indexer to: `http://localhost:8545`

Configure your indexer with your preferred pattern (environment variables, a config file, CLI flags, etc.). For example:
```bash
RPC_URL=http://localhost:8545
```

To see the latest available block, you may use the following query:

```bash
curl 127.0.0.1:8545 -X POST -H "Content-Type: application/json" -d '{"jsonrpc":"2.0", "method": "eth_getBlockByNumber", "params": ["latest", false], "id": "x"}' | jq .
```

To get the block number in plain text:

```bash
curl 127.0.0.1:8545 -X POST -H "Content-Type: application/json" -d '{"jsonrpc":"2.0", "method": "eth_getBlockByNumber", "params": ["latest", false], "id": "x"}' | jq .result.number -r | xargs printf "%d\n"
```

### 2. Implementing the Indexer

In this phase, you will write code to extract blockchain data and prepare it for loading into PostgreSQL. You will use the [JSON RPC API](https://openethereum.github.io/JSONRPC-eth-module) provided by the blockchain node for data indexing.

When indexing a live chain, a common approach is to follow the finalized chain tip instead of blindly tracking `latest`.
- Prefer querying `eth_getBlockByNumber` with `finalized` (or `safe`) to decide the upper bound.
- If you choose to index close to head, keep a confirmation buffer and implement a reorg strategy.

**The `indexer/` directory is provided as a placeholder - you need to initialize and implement the indexer from scratch.** See `indexer/README.md` for setup instructions for TypeScript or Go.

Your program should:
- Extract blockchain data (blocks, transactions, receipts) via JSON-RPC
- Store the data in PostgreSQL with proper schema design
- Handle errors and edge cases gracefully

Following the ELT approach, we aim to minimize data transformations during loading. However, consider these for ease of use:

- Convert blockNumber and timestamp to human-readable formats
- Store transactions separately from blocks for easier querying
- Design your schema to support efficient queries

For this task, scrape approximately the last couple of weeks of data.

Below are the relevant JSON RPC methods and their documentation links:

- Blocks
  - `eth_getBlockByNumber`
  - [Documentation](https://openethereum.github.io/JSONRPC-eth-module#eth_getblockbynumber)
  - This method can also return full transaction data if the second parameter is set to true. We used this query to verify the node's status.
- Transaction Receipts
  - `eth_getBlockReceipts`
  - [Documentation](https://www.quicknode.com/docs/ethereum/eth_getBlockReceipts)
  - This method returns transaction receipts, which need to be linked to transactions for analytics purposes, following the ELT workflow.

### 3. Loading Data into PostgreSQL

#### Setting Up PostgreSQL

We use PostgreSQL for this task due to its battle-tested reliability, excellent support for indexes, and widespread industry adoption.

PostgreSQL runs in Docker using the provided `docker-compose.yml` in the root directory:

```bash
# Start PostgreSQL (and Redis if needed)
docker-compose up -d postgres

# Check it's running
docker-compose ps

# Connect to PostgreSQL
psql postgresql://indexer:indexer_password@localhost:5432/indexer
```

#### Initialize the Database

A minimal schema setup is provided in `./sql/00_init.sql` - it only creates the `raw` schema.

```bash
psql postgresql://indexer:indexer_password@localhost:5432/indexer -f sql/00_init.sql
```

#### Design Your Schema

You need to create tables for:
- `raw.blocks` - Block-level blockchain data
- `raw.transactions` - Individual transaction data
- `raw.receipts` - Transaction receipt data with execution results

Consider:
- **Primary keys** on natural identifiers (block_number, transaction hash)
- **Indexes** on columns used for queries and joins (timestamps, addresses, block numbers)
- **Data types** suitable for blockchain data (BIGINT/NUMERIC for large numbers, JSONB for nested structures)
- **Idempotent inserts** using `ON CONFLICT DO NOTHING`
- **Performance** via batch inserts and connection pooling

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
     - Orphaned transactions and missing receipts
     - Null value checks on critical fields
   - Save queries in a SQL file (e.g., `qa_checks.sql`)

#### Expected Deliverables

- SQL files for schema creation, data model, and QA checks
- Follow naming convention: `01_schema.sql`, `02_transactions.sql` etc.
- Each file should be self-contained and documented
- Include any assumptions made in SQL comments
- Document your indexing strategy and why you chose specific indexes
- Document which blockchain/RPC endpoint you used
- Note any AI tools used and how they helped
