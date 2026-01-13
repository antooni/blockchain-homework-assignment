## Infrastructure considerations

### Single Indexer on a single machine
- simplest to implement and maintain
- parallelizes network calls (Promise.all())

### Multiple Indexers on a single machine 
- parallelizes CPU operations (JSON.parse())
- possible port exhaustion (~ 65000 ports)

### Multiple Indexers on different machines 
- removes network I/O bottleneck (felt only if connected to high throughput RPC)
- system continues indexing in case of Indexer going offline
- database write pressure needs to be mitigated (there is now potentially 4x more calls to DB)

✅ Choice: Multiple Indexers on a single machine
- good balance between simplicity and performance (for homework scope)
- does not introduce deployment complexity of multiple servers

---

## Database performance considerations

### Critical DB operation: batch insert
- "Idempotent Batch Insert" (simplified version that does nothing on conflict) ```INSERT INTO t VALUES (A), (B), (C) ON CONFLICT DO NOTHING``` 

- avoid parameter limit in a single query (~ 65k): split into chunks & ensure it happens inside one  DB transaction

### Connection pool
- PostgreSQL is process-based, not thread-based; every connection spawns a heavy OS process
- small number of active connections executing queries very quickly, not a large number of connections waiting
- conservative homework calculations (4 clients x 5 connections x 100 TPS = 2000 writes/s)

### Index Overhead
- every write updates indexes, add only crucial ones
- potentially for large re-sync: drop non-crucial indexes (not PK or ones used in ON CONFLICT) and recreate them after data is synced

---

## Database model considerations
Schema is available at ./sql folder

### RPC calls return types
- https://www.quicknode.com/docs/ethereum/eth_getBlockByNumber
- https://www.quicknode.com/docs/ethereum/eth_getTransactionByHash
- https://www.quicknode.com/docs/ethereum/eth_getBlockReceipts

### Hashes
- use `TEXT` although `BYTEA` would be more space efficient it would introduce complexity (debugging, decoding)

### Values
- use `NUMERIC(78,0)` - it will fit EVM's 2^256 values, for simplicity all bigints will be stored using the same precision

### Nested data types
- normalized schema over JSONB because Topics are fundamental query keys in Ethereum, and B-Tree indexes on specific columns offer better performance than GIN indexes on nested JSON arrays

### Cascade deletes
- would be needed for re-org handling, in the homework scope we skip it althogether

### Pending blocks/transactions
- it is possible that some fields would be set to `null` but we skip it in homework scope

---

## Work Distribution

```
[Queue: Work] --(BLMOVE)--> [Queue: Processing]
                                  |
                                  +--> [Worker] --(SET NX)--> [Lock: Key]
                                          |
                                          +--> [RPC / DB]
```

### Redis Queue with Leases
- "Seeder" routine (running on one instance) populates the Redis queue with range tasks. Workers autonomously pull these tasks, decoupling assignment from processing
- Redis lists: Use `queue:work` for pending tasks and `queue:processing` for active tasks
- atomic handoff: Workers use `BLMOVE` to fetch work. This ensures zero data loss if a worker crashes immediately after popping but before acquiring the lock (the task remains safely in the processing queue)
- leasing: Workers acquire a distributed lock `(SET ... NX EX 60)` for the specific block range upon fetching
- timeouts: RPC timeout is set strictly lower than lease TTL (e.g., 20s vs 60s) to ensure healthy workers don't lose their leases due to slow network responses
- macro-batching: Redis ranges are small batches (e.g., 20-50 blocks)
- micro-concurrency: Inside the worker, Promise.all (with p-limit concurrency control) fetches blocks in parallel

### Failure Recovery (The "Janitor" Logic)
- passive recovery via lease expiration.
- background routine monitors `queue:processing`. If a task's lock has expired (worker crashed), it is atomically moved back to `queue:work

---

## Rate limiting

### Sliding Window Log
- mechanism: Redis Sorted Set (`ratelimit:global`). Score: Unix Timestamp (ms). Member: Unique Request ID.
- logic: Before every RPC call, a Lua Script executes **atomically**:
``` 
Removes entries older than window_size (1s).
Counts remaining entries.
If count < limit, adds new entry and allows request.
If count >= limit, rejects request.
```
- Provides precise strict limits (prevents "boundary bursts" common in fixed-window counters) and is concurrency-safe across multiple processes.

---

## Retries

### Local retry
- attempt N times inside the worker
- backoff: Exponential (1s, 2s, 4s...) + Random Jitter (to prevent thundering herd)
- must extend the Redis Lease (EXPIRE) during backoff sleeps to prevent the Janitor from reclaiming the task

### Global retry
- if all local attempts fail (e.g., persistent RPC error), the task is moved to the back of `queue:work` `(LMOVE ... RIGHT)`

---

## Progress Persistence

### Database as source of truth
- on full system restart, the Redis queue preserves the order
- block is only considered "done" when committed to PostgreSQL
- out of homework scope: if Redis data is lost (worst case), a "Startup Reconciliation" script would query Postgres (MAX(block)) to re-seed the queue from the last checkpoint, it should also look for the gaps in data

---

## Reorg handling

- system will not handle reorgs 
- use `finalized` block number as upper bound
  - block becomes finalized after 2 epochs (~12.8 minutes), it cannot be reverted unless 1/3 of all staked ETH is slashed (billions of dollars burned)
