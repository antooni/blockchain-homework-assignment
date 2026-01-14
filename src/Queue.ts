import { randomUUID } from 'node:crypto'
import type Redis from 'ioredis'

export class Queue {
  private readonly Q_WORK = 'queue:work'
  private readonly Q_PROCESSING = 'queue:processing'
  private readonly RATE_LIMIT_KEY = 'ratelimit:global'

  private readonly LOCK_PREFIX = 'lock:range:'
  private readonly LEASE_TTL = 300
  private readonly BATCH_SIZE = 50n

  constructor(
    private client: Redis,
    private blockingClient: Redis,
  ) {
    // Register the Sliding Window Lua Script
    // This ensures checking the limit + adding the timestamp happens atomically
    this.client.defineCommand('acquireRateLimitToken', {
      numberOfKeys: 1,
      lua: `
        local key = KEYS[1]
        local window = tonumber(ARGV[1])
        local limit = tonumber(ARGV[2])
        local now = tonumber(ARGV[3])
        local unique_id = ARGV[4]

        -- 1. Remove entries older than the window (Clean up)
        redis.call('ZREMRANGEBYSCORE', key, '-inf', now - window)

        -- 2. Count current requests in the window
        local count = redis.call('ZCARD', key)

        if count < limit then
          -- 3. Allowed: Add new entry (Score=Time, Member=UniqueId)
          redis.call('ZADD', key, now, unique_id)
          -- Set expiry to auto-clean key if system goes idle
          redis.call('PEXPIRE', key, window)
          return 1
        else
          -- 4. Rejected
          return 0
        end
      `,
    })
  }

  // ... [Existing Methods: parseRange, addBatches, seed, next, extendLease, complete, fail, recoverZombies] ...

  /**
   * Rate Limiter: Sliding Window Log
   * Checks if we can perform an RPC call within the global limit.
   * * @param limit Max requests per window (e.g., 50)
   * @param windowMs Window size in milliseconds (e.g., 1000 for 1s)
   * @returns true if allowed, false if rate limited
   */
  async acquireToken(limit: number, windowMs = 1000): Promise<boolean> {
    const now = Date.now()
    const uniqueId = randomUUID() // Needed because ZADD requires unique members

    // @ts-ignore: ioredis adds dynamic methods based on defineCommand
    const result = await this.client.acquireRateLimitToken(
      this.RATE_LIMIT_KEY,
      windowMs,
      limit,
      now,
      uniqueId,
    )

    return result === 1
  }

  // ... [Rest of your existing code below] ...

  // (Including the previous methods for context if you copy-paste the whole file)
  private parseRange(rangeStr: string): [bigint, bigint] {
    const [start, end] = rangeStr.split('-')
    // biome-ignore lint: we know it is defined
    return [BigInt(start!), BigInt(end!)]
  }

  async addBatches(fromBlock: bigint, toBlock: bigint) {
    const pipeline = this.client.pipeline()
    for (let start = fromBlock; start <= toBlock; start += this.BATCH_SIZE) {
      let end = start + this.BATCH_SIZE - 1n
      if (end > toBlock) end = toBlock
      const rangeStr = `${start}-${end}`
      pipeline.rpush(this.Q_WORK, rangeStr)
    }
    await pipeline.exec()
    console.log(
      `📥 Added batches from ${fromBlock.toLocaleString()} to ${toBlock.toLocaleString()}`,
    )
  }

  async seed(targetBlock: bigint, lastIndexed: bigint | undefined) {
    const [waiting, active] = await Promise.all([
      this.client.llen(this.Q_WORK),
      this.client.llen(this.Q_PROCESSING),
    ])

    if (waiting + active > 0) {
      console.log(
        `🔄 Queue state preserved (${waiting} waiting, ${active} processing). Resuming...`,
      )
      return
    }

    console.log('📭 Queue is empty. Checking database status...')
    const start = lastIndexed !== undefined ? lastIndexed + 1n : 0n

    if (start > targetBlock) {
      console.log('✅ Database is already ahead of target. No seeding needed.')
      return
    }

    console.log(`🌱 Seeding queue ranges from Block ${start} to ${targetBlock}...`)
    await this.addBatches(start, targetBlock)
  }

  async next(): Promise<[bigint, bigint]> {
    const rangeStr = await this.blockingClient.blmove(
      this.Q_WORK,
      this.Q_PROCESSING,
      'LEFT',
      'RIGHT',
      0,
    )
    if (!rangeStr) throw new Error('Queue closed or empty')
    const [from, to] = this.parseRange(rangeStr)
    await this.client.set(`${this.LOCK_PREFIX}${rangeStr}`, '1', 'EX', this.LEASE_TTL)
    return [from, to]
  }

  async extendLease(from: bigint, to: bigint) {
    const rangeStr = `${from}-${to}`
    await this.client.expire(`${this.LOCK_PREFIX}${rangeStr}`, this.LEASE_TTL)
  }

  async complete(from: bigint, to: bigint) {
    const rangeStr = `${from}-${to}`
    const pipeline = this.client.pipeline()
    pipeline.lrem(this.Q_PROCESSING, 1, rangeStr)
    pipeline.del(`${this.LOCK_PREFIX}${rangeStr}`)
    await pipeline.exec()
  }

  async fail(from: bigint, to: bigint) {
    const rangeStr = `${from}-${to}`
    const pipeline = this.client.pipeline()
    pipeline.lrem(this.Q_PROCESSING, 1, rangeStr)
    pipeline.del(`${this.LOCK_PREFIX}${rangeStr}`)
    pipeline.rpush(this.Q_WORK, rangeStr)
    await pipeline.exec()
  }

  async recoverZombies() {
    const processing = await this.client.lrange(this.Q_PROCESSING, 0, -1)
    if (processing.length === 0) return
    let recovered = 0
    for (const rangeStr of processing) {
      const isLocked = await this.client.exists(`${this.LOCK_PREFIX}${rangeStr}`)
      if (!isLocked) {
        console.warn(`🧟 Zombie detected: Range ${rangeStr}. Re-queueing...`)
        const tx = this.client.multi()
        tx.lrem(this.Q_PROCESSING, 1, rangeStr)
        tx.rpush(this.Q_WORK, rangeStr)
        await tx.exec()
        recovered++
      }
    }
    if (recovered > 0) {
      console.log(`❤️  Janitor recovered ${recovered} ranges.`)
    }
  }
}
