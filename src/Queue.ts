import { randomUUID } from 'node:crypto'
import type Redis from 'ioredis'

export class Queue {
  private readonly Q_WORK = 'queue:work'
  private readonly Q_PROCESSING = 'queue:processing'
  private readonly RATE_LIMIT_KEY = 'ratelimit:global'
  private readonly LOCK_PREFIX = 'lock:range:'
  private readonly LAST_QUEUED_KEY = 'queue:lastQueued'
  private readonly LAST_PROCESSED_KEY = 'queue:lastProcessed'

  constructor(
    private client: Redis,
    private blockingClient: Redis,
    private options: {
      batchSize: bigint
      leaseTTL: number
      minBlockNumber: bigint
    },
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

    // Register Lua script for atomic lastProcessed update (only if higher)
    this.client.defineCommand('updateLastProcessedIfHigher', {
      numberOfKeys: 1,
      lua: `
        local key = KEYS[1]
        local newValue = tonumber(ARGV[1])
        local current = redis.call('GET', key)

        if not current or newValue > tonumber(current) then
          redis.call('SET', key, ARGV[1])
          return 1
        end
        return 0
      `,
    })
  }

  /**
   * Rate Limiter: Sliding Window Log
   * Checks if we can perform an RPC call within the global limit.
   * @param limit Max requests per window (e.g., 50)
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

  private parseRange(rangeStr: string): [bigint, bigint] {
    const [start, end] = rangeStr.split('-')
    // biome-ignore lint: we know it is defined
    return [BigInt(start!), BigInt(end!)]
  }

  /**
   * Get the last block number that was queued (added to the work queue)
   */
  async getLastQueued(): Promise<bigint | null> {
    const val = await this.client.get(this.LAST_QUEUED_KEY)
    return val ? BigInt(val) : null
  }

  /**
   * Set the last block number that was queued
   */
  async setLastQueued(block: bigint): Promise<void> {
    await this.client.set(this.LAST_QUEUED_KEY, block.toString())
  }

  /**
   * Get the last block number that was successfully processed
   */
  async getLastProcessed(): Promise<bigint | null> {
    const val = await this.client.get(this.LAST_PROCESSED_KEY)
    return val ? BigInt(val) : null
  }

  /**
   * Update lastProcessed only if the new value is higher (atomic operation)
   */
  async updateLastProcessed(block: bigint): Promise<void> {
    // @ts-ignore: ioredis adds dynamic methods based on defineCommand
    await this.client.updateLastProcessedIfHigher(this.LAST_PROCESSED_KEY, block.toString())
  }

  async addBatches(fromBlock: bigint, toBlock: bigint) {
    const pipeline = this.client.pipeline()
    for (let start = fromBlock; start <= toBlock; start += this.options.batchSize) {
      let end = start + this.options.batchSize - 1n
      if (end > toBlock) end = toBlock
      const rangeStr = `${start}-${end}`
      pipeline.rpush(this.Q_WORK, rangeStr)
    }
    await pipeline.exec()
    console.log(
      `📥 Added batches from ${fromBlock.toLocaleString()} to ${toBlock.toLocaleString()}`,
    )
  }

  async seed(targetBlock: bigint) {
    const [waiting, active] = await Promise.all([
      this.client.llen(this.Q_WORK),
      this.client.llen(this.Q_PROCESSING),
    ])

    if (waiting + active > 0) {
      console.log(`🔄 Queue has work (${waiting} waiting, ${active} processing).`)
    }

    // Determine the starting point for new batches
    // Use the highest of: lastQueued+1, lastIndexed+1, or 0
    const lastQueued = await this.getLastQueued()

    let start: bigint
    if (lastQueued !== null) {
      start = lastQueued + 1n
    } else {
      start = this.options.minBlockNumber
    }

    if (start > targetBlock) {
      console.log('✅ All blocks up to target have been queued.')
      return
    }

    console.log(`🌱 Adding queue ranges from Block ${start} to ${targetBlock}...`)
    await this.addBatches(start, targetBlock)
    await this.setLastQueued(targetBlock)
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
    await this.client.set(`${this.LOCK_PREFIX}${rangeStr}`, '1', 'EX', this.options.leaseTTL)
    return [from, to]
  }

  async extendLease(from: bigint, to: bigint) {
    const rangeStr = `${from}-${to}`
    await this.client.expire(`${this.LOCK_PREFIX}${rangeStr}`, this.options.leaseTTL)
  }

  async complete(from: bigint, to: bigint) {
    const rangeStr = `${from}-${to}`
    const pipeline = this.client.pipeline()
    pipeline.lrem(this.Q_PROCESSING, 1, rangeStr)
    pipeline.del(`${this.LOCK_PREFIX}${rangeStr}`)
    await pipeline.exec()

    // Track the highest successfully processed block
    await this.updateLastProcessed(to)
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
