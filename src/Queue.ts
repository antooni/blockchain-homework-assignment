import type Redis from 'ioredis'

export class Queue {
  private readonly Q_WORK = 'queue:work'
  private readonly Q_PROCESSING = 'queue:processing'
  private readonly LOCK_PREFIX = 'lock:block:'
  private readonly LEASE_TTL = 60 // Seconds

  constructor(
    private client: Redis,
    private blockingClient: Redis,
  ) {}

  async addRange(fromBlock: number, toBlock: number) {
    const pipeline = this.client.pipeline()
    // Reverse loop to push in correct order (since we LPUSH or RPUSH)
    // If we RPUSH (add to tail), we iterate normally.
    for (let i = fromBlock; i <= toBlock; i++) {
      pipeline.rpush(this.Q_WORK, i.toString())
    }
    await pipeline.exec()
    console.log(`📥 Added range ${fromBlock}-${toBlock} to queue.`)
  }

  /**
   * The "Pull" Mechanism
   * 1. Atomically moves block from 'work' -> 'processing' (BLMOVE).
   * 2. Sets a Lease Lock (Heartbeat) so Janitor knows we are alive.
   */
  async next(): Promise<number> {
    // BLMOVE source destination LEFT|RIGHT LEFT|RIGHT TIMEOUT
    // Moves from Head of Work (LEFT) to Tail of Processing (RIGHT)
    // 0 = Block indefinitely until work is available
    const blockStr = await this.blockingClient.blmove(
      this.Q_WORK,
      this.Q_PROCESSING,
      'LEFT',
      'RIGHT',
      0,
    )

    if (!blockStr) throw new Error('Queue closed or empty') // Should not happen with timeout 0

    const block = parseInt(blockStr)

    // Acquire Lease immediately
    await this.client.set(`${this.LOCK_PREFIX}${block}`, '1', 'EX', this.LEASE_TTL)

    return block
  }

  /**
   * Call this periodically inside the worker loop while processing
   * to prevent the Janitor from stealing your job during long I/O.
   */
  async extendLease(block: number) {
    await this.client.expire(`${this.LOCK_PREFIX}${block}`, this.LEASE_TTL)
  }

  /**
   * Successful Completion
   * 1. Remove from 'processing' queue.
   * 2. Remove the Lease Lock.
   */
  async complete(block: number) {
    const pipeline = this.client.pipeline()
    pipeline.lrem(this.Q_PROCESSING, 1, block.toString()) // Remove 1 occurrence
    pipeline.del(`${this.LOCK_PREFIX}${block}`)
    await pipeline.exec()
  }

  /**
   * Explicit Failure (e.g. RPC Error)
   * Move the block back to the 'work' queue so another worker can try.
   */
  async fail(block: number) {
    const pipeline = this.client.pipeline()
    pipeline.lrem(this.Q_PROCESSING, 1, block.toString())
    pipeline.del(`${this.LOCK_PREFIX}${block}`)
    pipeline.rpush(this.Q_WORK, block.toString()) // Add back to end of queue
    await pipeline.exec()
  }

  /**
   * The "Janitor" Routine (Health Check)
   * Scans 'processing' queue for zombie tasks (expired locks) and re-queues them.
   */
  async recoverZombies() {
    // 1. Get all blocks currently marked as "Processing"
    const processing = await this.client.lrange(this.Q_PROCESSING, 0, -1)

    if (processing.length === 0) return

    let recovered = 0

    for (const blockStr of processing) {
      const block = parseInt(blockStr)
      // Check if lock exists
      const isLocked = await this.client.exists(`${this.LOCK_PREFIX}${block}`)

      if (!isLocked) {
        // Lock is gone = Worker crashed or timed out.
        console.warn(`🧟 Zombie detected: Block ${block}. Re-queueing...`)

        // Transaction: Remove from Processing -> Add to Work
        const tx = this.client.multi()
        tx.lrem(this.Q_PROCESSING, 1, blockStr)
        tx.rpush(this.Q_WORK, blockStr) // Put at back of line
        await tx.exec()

        recovered++
      }
    }

    if (recovered > 0) {
      console.log(`❤️  Janitor recovered ${recovered} blocks.`)
    }
  }
}
