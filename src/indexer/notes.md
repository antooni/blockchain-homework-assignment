every indexer unique id
  blocks: on conflict number check if tx hash differ, if so then throw

```
INSERT INTO blocks (number, hash, parent_hash, timestamp, ...)
VALUES 
  (100, '0xNewHash...', '0x...', 123456789, ...),
  (101, '0x...', '0x...', 123456790, ...)
ON CONFLICT (number) 
DO UPDATE SET 
  -- 1. Try to set the Primary Key to NULL (which is illegal)
  number = NULL 
WHERE 
  -- 2. ...BUT only do it if the existing hash is different
  blocks.hash IS DISTINCT FROM EXCLUDED.hash;
```

```
async saveBatch(blocks: Block[]): Promise<void> {
    try {
        await client.query(`
            INSERT INTO blocks (...) VALUES ...
            ON CONFLICT (number) 
            DO UPDATE SET number = NULL WHERE blocks.hash != EXCLUDED.hash
        `);
        // ... handle txs ...
    } catch (err: any) {
        if (err.code === '23502') { // Postgres code for Not Null Violation
            console.error("🚨 REORG DETECTED! Block number collision with different hash.");
            throw new Error("ReorgDetected");
        }
        throw err;
    }
}
```
