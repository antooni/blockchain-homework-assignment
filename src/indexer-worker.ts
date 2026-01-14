import { parentPort, workerData } from 'node:worker_threads'
import Redis from 'ioredis'
import { Pool } from 'pg'
import { createPublicClient, http } from 'viem'
import { anvil } from 'viem/chains'
import { Database } from './Database'
import { Fetcher } from './Fetcher'
import { Indexer } from './Indexer'
import { Queue } from './Queue'

interface WorkerConfig {
  workerId: string
  redisUrl: string
  postgresConfig: {
    password: string | undefined
    user: string | undefined
    database: string | undefined
  }
  rpcUrl: string | undefined
  queueOptions: {
    batchSize: string
    leaseTTL: number
  }
  indexerOptions: {
    maxRetries: number
    maxBlocksToProcessAtOnce: number
    rpcCallsPerSecond: number
  }
}

async function runWorker() {
  const config = workerData as WorkerConfig

  console.log(`🧵 Worker ${config.workerId} starting...`)

  // Initialize Postgres connection pool
  const pool = new Pool({
    password: config.postgresConfig.password,
    user: config.postgresConfig.user,
    database: config.postgresConfig.database,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  })

  const database = new Database(pool)

  // Initialize RPC client
  const rpcClient = createPublicClient({
    chain: anvil,
    transport: http(config.rpcUrl),
  })

  // Initialize Redis clients (each worker needs its own connections)
  const redisClient = new Redis(config.redisUrl)
  const redisBlockingClient = new Redis(config.redisUrl)

  const queue = new Queue(redisClient, redisBlockingClient, {
    batchSize: BigInt(config.queueOptions.batchSize),
    leaseTTL: config.queueOptions.leaseTTL,
  })

  const fetcher = new Fetcher(rpcClient, queue, {
    rpcCallsPerSecond: config.indexerOptions.rpcCallsPerSecond,
    maxRetries: config.indexerOptions.maxRetries,
  })

  const indexer = new Indexer(database, fetcher, queue, {
    id: config.workerId,
    maxBlocksToProcessAtOnce: config.indexerOptions.maxBlocksToProcessAtOnce,
  })

  // Handle graceful shutdown
  const shutdown = async () => {
    console.log(`🛑 Worker ${config.workerId} shutting down...`)
    indexer.stop()
    await redisClient.quit()
    await redisBlockingClient.quit()
    await pool.end()
    process.exit(0)
  }

  // Listen for termination signal from parent
  parentPort?.on('message', async (message) => {
    if (message === 'shutdown') {
      await shutdown()
    }
  })

  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)

  // Start the indexer
  try {
    await indexer.start()
  } catch (error) {
    console.error(`💥 Worker ${config.workerId} crashed:`, error)
    await shutdown()
  }
}

runWorker().catch((error) => {
  console.error('Worker failed to start:', error)
  process.exit(1)
})
