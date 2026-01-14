import pLimit from 'p-limit'
import type { Database } from './Database'
import type { Fetcher } from './Fetcher'
import type { Queue } from './Queue'
import type { BlockRecord, LogRecord, TransactionRecord } from './types'

export class Indexer {
  private isRunning = false

  constructor(
    private database: Database,
    private fetcher: Fetcher,
    private queue: Queue,
    private options: {
      id: string
      maxBlocksToProcessAtOnce: number
    },
  ) {}

  async start() {
    this.isRunning = true

    while (this.isRunning) {
      let currentRange: [bigint, bigint] | null = null

      try {
        // 1. Get the Lease (e.g., 100-149)
        currentRange = await this.queue.next()
        const [from, to] = currentRange

        console.log(`[${this.options.id}] 🔄 Processing batch: ${from}-${to}`)

        // 2. Heartbeat (Keep lease alive while we download/save)
        const heartbeat = setInterval(() => {
          if (this.isRunning) this.queue.extendLease(from, to)
        }, 30000)

        // 3. Process Whole Batch
        await this.processRange(from, to)

        // 4. Ack
        clearInterval(heartbeat)
        await this.queue.complete(from, to)
        console.log(`[${this.options.id}] ✅ Completed batch: ${from}-${to}`)
      } catch (error) {
        if (currentRange) {
          const [from, to] = currentRange
          console.error(`[${this.options.id}] 💥 Failed batch ${from}-${to}:`, error)
          await this.queue.fail(from, to)
        }
        await sleep(2000)
      }
    }
  }

  async processRange(from: bigint, to: bigint) {
    const limit = pLimit(this.options.maxBlocksToProcessAtOnce)
    const tasks: Promise<
      | {
          blockRecord: BlockRecord
          txRecords: TransactionRecord[]
          logRecords: LogRecord[]
        }
      | undefined
    >[] = []

    for (let i = from; i <= to; i++) {
      tasks.push(limit(() => this.fetchAndTransform(i)))
    }

    const results = (await Promise.all(tasks)).filter((x) => x !== undefined)

    // 2. GATHER: Flatten results into big arrays
    // Result type is { blockRecord, txRecords[], logRecords[] }
    const blocks: BlockRecord[] = results.map((r) => r.blockRecord)
    const txs: TransactionRecord[] = results.flatMap((r) => r.txRecords)
    const logs: LogRecord[] = results.flatMap((r) => r.logRecords)

    // 3. SAVE: One Atomic Transaction
    if (blocks.length > 0) {
      // Assuming your DB method signature is updated to accept arrays:
      // saveBulk(blocks[], txs[], logs[])
      await this.database.save(blocks, txs, logs)
    }
  }

  /**
   * Helper: Fetches and Transforms a SINGLE block.
   * Retry logic is handled by the Fetcher.
   */
  private async fetchAndTransform(blockNum: bigint) {
    return await this.fetcher.fetch(blockNum)
  }

  stop() {
    this.isRunning = false
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
