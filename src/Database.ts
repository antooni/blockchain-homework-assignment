import type { Pool } from 'pg'
import type { BlockRecord, LogRecord, TransactionRecord } from './types'

export class Database {
  constructor(private pool: Pool) {}

  async save(blocks: BlockRecord[], txs: TransactionRecord[], logs: LogRecord[]) {
    const BATCH_SIZE = 1000
    const client = await this.pool.connect()

    try {
      await client.query('BEGIN')

      const blockChunks = chunk(blocks, BATCH_SIZE)

      for (const batch of blockChunks) {
        await client.query(
          `
        INSERT INTO blocks (
          number, hash, parent_hash, nonce, sha3_uncles, timestamp, miner, extra_data, size,
          gas_limit, gas_used, difficulty, base_fee_per_gas,
          state_root, receipts_root, transactions_root, logs_bloom
        )
        SELECT * FROM UNNEST(
          $1::bigint[], $2::text[], $3::text[], $4::text[], $5::text[],
          $6::timestamptz[],
          $7::text[], $8::text[], $9::numeric[],
          $10::numeric[], $11::numeric[], $12::numeric[], $13::numeric[],
          $14::text[], $15::text[], $16::text[], $17::text[]
        )
        ON CONFLICT (number)
        DO UPDATE SET
          number = NULL
        WHERE
          blocks.hash IS DISTINCT FROM EXCLUDED.hash
      `,
          [
            batch.map((b) => b.number),
            batch.map((b) => b.hash),
            batch.map((b) => b.parent_hash),
            batch.map((b) => b.nonce),
            batch.map((b) => b.sha3_uncles),
            batch.map((b) => new Date(Number(b.timestamp) * 1000)),
            batch.map((b) => b.miner),
            batch.map((b) => b.extra_data),
            batch.map((b) => b.size),
            batch.map((b) => b.gas_limit),
            batch.map((b) => b.gas_used),
            batch.map((b) => b.difficulty),
            batch.map((b) => b.base_fee_per_gas),
            batch.map((b) => b.state_root),
            batch.map((b) => b.receipts_root),
            batch.map((b) => b.transactions_root),
            batch.map((b) => b.logs_bloom),
          ],
        )
      }

      const txChunks = chunk(txs, BATCH_SIZE)

      for (const batch of txChunks) {
        await client.query(
          `
        INSERT INTO transactions (
          hash, nonce, block_hash, block_number, transaction_index, from_address, to_address, value, gas, gas_price,
          input, v, r, s, type, max_fee_per_gas, max_priority_fee_per_gas,
          contract_address, effective_gas_price, receipt_status, cumulative_gas_used, block_timestamp
        )
        SELECT * FROM UNNEST(
          $1::text[], $2::numeric[], $3::text[], $4::bigint[], $5::int[], $6::text[], $7::text[], $8::numeric[], $9::numeric[], $10::numeric[],
          $11::text[], $12::numeric[], $13::numeric[], $14::numeric[], $15::int[], $16::numeric[], $17::numeric[],
          $18::text[], $19::numeric[], $20::int[], $21::numeric[],
          $22::timestamptz[] -- Ensures this matches the column type
        )
        ON CONFLICT (hash) DO NOTHING
      `,
          [
            batch.map((t) => t.hash),
            batch.map((t) => t.nonce),
            batch.map((t) => t.block_hash),
            batch.map((t) => t.block_number),
            batch.map((t) => t.transaction_index),
            batch.map((t) => t.from_address),
            batch.map((t) => t.to_address),
            batch.map((t) => t.value),
            batch.map((t) => t.gas),
            batch.map((t) => t.gas_price),
            batch.map((t) => t.input),
            batch.map((t) => t.v),
            batch.map((t) => t.r),
            batch.map((t) => t.s),
            batch.map((t) => t.type),
            batch.map((t) => t.max_fee_per_gas),
            batch.map((t) => t.max_priority_fee_per_gas),
            batch.map((t) => t.contract_address),
            batch.map((t) => t.effective_gas_price),
            batch.map((t) => t.receipt_status),
            batch.map((t) => t.cumulative_gas_used),
            batch.map((t) => new Date(Number(t.block_timestamp) * 1000)),
          ],
        )
      }

      const logChunks = chunk(logs, BATCH_SIZE)

      for (const batch of logChunks) {
        await client.query(
          `
        INSERT INTO logs (
          transaction_hash, log_index, transaction_index, block_hash, block_number, address, data, removed,
          topic0, topic1, topic2, topic3
        )
        SELECT * FROM UNNEST(
          $1::text[], $2::int[], $3::int[], $4::text[], $5::bigint[], $6::text[], $7::text[], $8::boolean[],
          $9::text[], $10::text[], $11::text[], $12::text[]
        )
        ON CONFLICT (transaction_hash, log_index) DO NOTHING
      `,
          [
            batch.map((l) => l.transaction_hash),
            batch.map((l) => l.log_index),
            batch.map((l) => l.transaction_index),
            batch.map((l) => l.block_hash),
            batch.map((l) => l.block_number),
            batch.map((l) => l.address),
            batch.map((l) => l.data),
            batch.map((l) => l.removed),
            batch.map((l) => l.topic0),
            batch.map((l) => l.topic1),
            batch.map((l) => l.topic2),
            batch.map((l) => l.topic3),
          ],
        )
      }

      await client.query('COMMIT')
      console.log(`✅ Saved ${blocks.length} blocks, ${txs.length} txs, and ${logs.length} logs.`)
    } catch (e) {
      await client.query('ROLLBACK')

      if (isPgError(e) && e.code === '23502') {
        console.error(`🚨 REORG DETECTED! Block number collision with different hash in batch.`)
        throw new Error('ReorgDetected')
      }

      console.error(`❌ Failed to save block batch`, e)
      throw e
    } finally {
      client.release()
    }
  }
}

const chunk = <T>(array: T[], size: number): T[][] => {
  if (!array.length) return []
  const chunks: T[][] = []
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size))
  }
  return chunks
}

export function isPgError(e: unknown): e is Error & { code: string } {
  return typeof e === 'object' && e !== null && 'code' in e
}
