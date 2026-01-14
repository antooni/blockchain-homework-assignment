import path from 'node:path'
import { Worker } from 'node:worker_threads'
import Redis from 'ioredis'
import { Pool } from 'pg'
import { createPublicClient, http, type PublicClient } from 'viem'
import { anvil } from 'viem/chains'
import { Database } from './Database'
import { Queue } from './Queue'

const config = {
  db: {
    password: process.env.POSTGRES_PASSWORD,
    user: process.env.POSTGRES_USER,
    database: process.env.POSTGRES_DB,
    max: Number(process.env.POSTGRES_MAX_CONNECTIONS ?? 4),
    idleTimeoutMillis: Number(process.env.IDLE_TIMEOUT ?? 30000),
    connectionTimeoutMillis: Number(process.env.CONNECTION_TIMEOUT ?? 2000),
  },
  redis: {
    url: process.env.REDIS_URL ?? 'redis://localhost:6379',
  },
  queue: {
    batchSize: BigInt(process.env.BATCH_SIZE ?? 20),
    leaseTTL: Number(process.env.LEASE_TTL ?? 300),
    minBlockNumber: BigInt(process.env.MIN_BLOCK_NUMBER ?? 24219023),
  },
  rpc: {
    callsPerSecond: Number(process.env.RPC_CALLS_PER_SECOND ?? 50),
    maxRetries: Number(process.env.RPC_MAX_RETRIES ?? 5),
  },
  indexers: {
    count: Number(process.env.INDEXERS_COUNT ?? 4),
    maxBlocksToProcessAtOnce: Number(process.env.INDEXERS_MAX_CONCURRENCY ?? 10),
  },
}

async function main() {
  const database = new Database(new Pool(config.db))

  const rpcClient = createPublicClient({
    chain: anvil,
    transport: http(),
  })

  const redisClient = new Redis(config.redis.url)
  const redisBlockingClient = new Redis(config.redis.url)

  const queue = new Queue(redisClient, redisBlockingClient, {
    batchSize: config.queue.batchSize,
    leaseTTL: config.queue.leaseTTL,
    minBlockNumber: config.queue.minBlockNumber,
  })

  const tip = await rpcClient.getBlockNumber()
  await queue.seed(tip)
  console.log('Queue initially seeded')

  startSeeder(rpcClient, database, queue)
  startJanitor(queue)

  // Spawn indexer workers in separate CPU threads
  const workers: Worker[] = []

  for (let i = 0; i < config.indexers.count; i++) {
    const worker = new Worker(path.join(__dirname, 'indexer-worker.js'), {
      workerData: {
        workerId: i.toString(),
        redisUrl: config.redis.url,
        postgresConfig: {
          password: config.db.password,
          user: config.db.user,
          database: config.db.database,
        },
        rpcUrl: process.env.RPC_URL,
        queueOptions: {
          batchSize: config.queue.batchSize.toString(),
          leaseTTL: config.queue.leaseTTL,
          minBlockNumber: config.queue.minBlockNumber,
        },
        indexerOptions: {
          maxRetries: config.rpc.maxRetries,
          maxBlocksToProcessAtOnce: config.indexers.maxBlocksToProcessAtOnce,
          rpcCallsPerSecond: config.rpc.callsPerSecond,
        },
      },
    })

    worker.on('error', (err) => {
      console.error(`💥 Worker ${i} error:`, err)
    })

    worker.on('exit', (code) => {
      if (code !== 0) {
        console.error(`💀 Worker ${i} exited with code ${code}`)
      }
    })

    workers.push(worker)
    console.log(`🧵 Spawned indexer worker ${i}`)
  }

  // Graceful shutdown handler
  const shutdown = async () => {
    console.log('🛑 Shutting down workers...')
    for (const worker of workers) {
      worker.postMessage('shutdown')
    }
    await Promise.all(workers.map((w) => new Promise((resolve) => w.on('exit', resolve))))
    await redisClient.quit()
    await redisBlockingClient.quit()
    process.exit(0)
  }

  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}

main().catch((e: unknown) => {
  console.error(e)
})

function startJanitor(queue: Queue) {
  setInterval(async () => {
    try {
      await queue.recoverZombies()
    } catch (err) {
      console.error('Janitor failed:', err)
    }
  }, 10000)
  console.log('Janitor started')
}

function startSeeder(rpcClient: PublicClient, database: Database, queue: Queue) {
  setInterval(async () => {
    try {
      const tip = await rpcClient.getBlockNumber()
      await queue.seed(tip)
    } catch (err) {
      console.error('Seeder failed:', err)
    }
  }, 10000)
  console.log('Seeder started')
}
