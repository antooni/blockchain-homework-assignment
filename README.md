# Token Terminal Blockchain Indexing Task

In this task, you will build a distributed blockchain indexing system where multiple scraper instances coordinate to extract block data from a shared RPC endpoint.

**Note on AI Usage**: We assume and encourage you to use AI coding assistants (GitHub Copilot, ChatGPT, Claude, etc.) to help you complete this assignment. This reflects modern development practices. Focus on understanding the system design and being able to explain your architectural decisions.

The system must handle:
- **Work distribution** across multiple instances
- **Rate limiting** to respect RPC endpoint limits
- **Fault tolerance** with retries and progress persistence
- **Coordination** via Redis

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Scraper 1  │     │  Scraper 2  │     │  Scraper N  │
└──────┬──────┘     └──────┬──────┘     └──────┬──────┘
        │                   │                   │
        └───────────┬───────┴───────────┬───────┘
                    │                   │
             ┌──────▼──────┐     ┌──────▼──────┐
             │    Redis    │     │   RPC Node  │
             │ Coordination│     │ (rate-limited)
             └─────────────┘     └─────────────┘
                    │
             ┌──────▼──────┐
             │ PostgreSQL  │
             │   Storage   │
             └─────────────┘
```

## Blockchain RPC Endpoint

You have **flexibility in choosing your blockchain and RPC endpoint**:

### Option 1: Anvil
We provide a ready-to-use Anvil setup in `anvil/`:
```bash
cd anvil
docker-compose up -d
# RPC available at http://localhost:8545
```

### Option 2: Your Own Chain/RPC
Alternatively, you can:
- Run your own blockchain node (Ethereum, Polygon, Arbitrum, etc.)
- Use public RPC endpoints (Infura, Alchemy, QuickNode, etc.)
- Use any EVM-compatible chain with `eth_*` JSON-RPC methods

**Required RPC Methods:**
- `eth_blockNumber` - Get latest block
- `eth_getBlockByNumber` - Get block with transactions
- `eth_getBlockReceipts` - Get transaction receipts

To reduce reorg complexity, a common approach is to follow the finalized (or safe) chain tip instead of indexing directly at `latest`.
- Prefer `eth_getBlockByNumber` with `finalized` (or `safe`) as the upper bound.
- If you choose to index near the tip, keep a confirmation buffer and implement a reorg strategy.

## What We Provide

| Component | Description |
|-----------|-------------|
| `docker-compose.yml` | Redis and PostgreSQL services |
| `anvil/docker-compose.yml` | Optional local Anvil RPC node setup |
| `sql/00_init.sql` | Minimal PostgreSQL setup (schema creation only) |
| `indexer/README.md` | Setup instructions for TypeScript or Go |

## What You Implement

Create a distributed indexer application (TypeScript or Go) that:

### 1. Work Distribution

Coordinate block range assignments across multiple scraper instances.

**Goal:**
- Avoid duplicate work across instances
- Support parallelism across multiple workers
- Make progress observable and resumable

**Common approaches:**
- Redis-backed queue/stream
- Leader assigns ranges, workers lease ranges
- Any other coordination method you can explain and justify

### 2. Distributed Rate Limiting

Respect the RPC endpoint's global rate limit across all instances.

**Goal:**
- Ensure the combined traffic from all workers stays within the RPC provider's limits

**Notes:**
- As a starting point, assume a global budget of roughly **50 requests/second** across all workers.
- How you coordinate this is up to you (Redis token bucket, per-worker budgets, centralized scheduler, etc.).

### 3. Retry with Backoff

Handle transient failures gracefully.

**Goal:**
- Recover from transient failures (timeouts, 429s, temporary RPC issues) without losing work

**Notes:**
- Exponential backoff with jitter is a common approach.
- Decide your own retry limits and failure handling based on your architecture.

### 4. Progress Persistence

Support resuming after restart.

**Goal:**
- Restarting workers should not require starting the entire indexing job from scratch
- The system should converge to completion even if workers crash

### 5. Data Output & Schema Design

Design and implement PostgreSQL schema for blockchain data.

**Goal:**
- Create tables for blocks, transactions, and receipts with appropriate:
  - Primary keys and unique constraints
  - Data types (consider numeric precision for large numbers, JSONB for nested data)
  - Indexes on columns used in queries and joins
- Ensure idempotent inserts (use `ON CONFLICT DO NOTHING` or similar)
- Consider batch inserts for efficiency (multi-row INSERT or COPY)
- Document your schema design choices

## Configuration

Your scraper should be configurable. You may choose your own configuration pattern (environment variables, a config file, CLI flags, etc.).

Common configuration inputs include:
```bash
REDIS_URL=redis://localhost:6379
RPC_URL=http://localhost:8545              # Your chosen RPC endpoint
POSTGRES_URL=postgresql://indexer:indexer_password@localhost:5432/indexer
BATCH_SIZE=100                             # Blocks per work unit
RATE_LIMIT=50                              # Requests per second (global)
WORKER_ID=worker-1                         # Unique identifier for this instance
```

## Getting Started

```bash
# Optional: customize local credentials/config
# cp .env.example .env

# Start infrastructure
docker-compose up -d
```

## Deliverables

1. **Source code** in `indexer/` implementing the scraper
2. **Brief documentation** explaining your approach (in code comments or a short APPROACH.md)
3. **RPC endpoint documentation** - Note which chain/RPC you used and any setup instructions
4. **Be prepared to discuss** failure scenarios and tradeoffs in the follow-up interview

## Evaluation Criteria

| Area | Weight | Description |
|------|--------|-------------|
| **Correctness** | 40% | All blocks scraped, no duplicates, data integrity |
| **Coordination** | 30% | Work distribution, rate limiting, progress tracking work correctly |
| **Fault Tolerance** | 20% | Handles failures gracefully, can resume after restart |
| **Code Quality** | 10% | Clean, readable, well-structured code |

## Time Expectation

This assignment is designed to take **3-4 hours** for the happy path implementation. Focus on getting the core functionality working correctly rather than over-engineering edge cases.

## Hints

**Coordination:**
- Redis `BLMOVE` (or `BRPOPLPUSH` for older Redis) is useful for atomic queue operations
- Consider using Redis `SET` with `NX` and `EX` options for distributed locking
- Sliding window rate limiting can be implemented with Redis sorted sets

**Database Design:**
- PostgreSQL supports `INSERT ... ON CONFLICT DO NOTHING` for idempotent inserts
- Index columns used in WHERE clauses, JOIN conditions, and ORDER BY
- B-tree indexes work well for numeric and timestamp columns
- JSONB type and GIN indexes are useful for nested data like logs
- Consider using BIGINT or NUMERIC for large blockchain numbers
- Connection pooling improves performance with concurrent workers

## Questions?

If anything is unclear, please reach out. We want to evaluate your distributed systems skills, not your ability to guess requirements.
