# Anvil Local Ethereum Node

This directory contains a Docker setup for running [Anvil](https://book.getfoundry.sh/anvil/), a fast local Ethereum development node from the Foundry toolkit.

## Features

- ✅ **Instant startup** - Ready in seconds, no sync required
- ✅ **Zero disk space** - Runs entirely in-memory
- ✅ **Pre-funded accounts** - 10 accounts with 10,000 ETH each
- ✅ **Full JSON-RPC compatibility** - All `eth_*` methods supported
- ✅ **Fork capable** - Can fork from any network (see options below)

## Quick Start

```bash
# Start Anvil
docker compose up -d

# View logs
docker logs -f anvil

# Stop Anvil
docker compose down
```

## Test the Node

Check if it's running:

```bash
# Get latest block number
curl -X POST http://localhost:8545 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' | jq

# Get block details
curl -X POST http://localhost:8545 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_getBlockByNumber","params":["latest",true],"id":1}' | jq
```

## Pre-funded Test Accounts

Anvil creates 10 test accounts with 10,000 ETH each. Private keys are deterministic (from test mnemonic):

```
Account #0: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
Private Key: 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80

Account #1: 0x70997970C51812dc3A010C7d01b50e0d17dc79C8
Private Key: 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d

... (8 more accounts)
```

## Configuration

This folder uses a single `docker-compose.yml`.

By default it runs Anvil with:

- A forked chain (upstream RPC configured in `docker-compose.yml`)
- A fast block time (configured in `docker-compose.yml`)

If you want Anvil in standalone mode (no fork), remove the `--fork-url=...` line from `docker-compose.yml`.

## Customization

Edit `docker-compose.yml` to customize:

```yaml
# Fork from a different network
--fork-url https://eth.llamarpc.com

# Fork at a different block
--fork-block-number 12345678

# Change chain ID
--chain-id 1

# Disable forking (standalone mode)
# Remove the --fork-url and --fork-block-number flags
```

## Why Anvil for This Assignment?

1. **No waiting** - Candidates can start immediately
2. **Realistic** - Fork from a real network if needed
3. **Simple** - Single Docker container, no complexity
4. **Resource-friendly** - No disk space or CPU-intensive syncing

## RPC Endpoint

Connect your indexer to: `http://localhost:8545`

Set in environment variables:

```bash
RPC_URL=http://localhost:8545
```

## Troubleshooting

**Port already in use:**

```bash
# Change port in docker-compose.yml
ports:
  - "8546:8545"  # Use 8546 instead
```

**Fork failing:**

```bash
# Check upstream RPC is accessible
curl https://eth.llamarpc.com

# Or run in standalone mode (remove --fork-url from docker-compose.yml)
```

## Documentation

- [Anvil Documentation](https://book.getfoundry.sh/anvil/)
- [Foundry Book](https://book.getfoundry.sh/)
- [JSON-RPC API](https://ethereum.org/en/developers/docs/apis/json-rpc/)
