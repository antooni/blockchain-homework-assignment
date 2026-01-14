import Redis from 'ioredis'
import { Pool } from 'pg'
import { createPublicClient, http } from 'viem'
import { anvil } from 'viem/chains'
import { Database } from './Database'
import { Queue } from './Queue'

async function main() {
  const pool = new Pool({
    password: process.env.POSTGRES_PASSWORD,
    user: process.env.POSTGRES_USER,
    database: process.env.POSTGRES_DB,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  })

  const database = new Database(pool)

  const rpcClient = createPublicClient({
    chain: anvil,
    transport: http(),
  })

  const redisUrl = process.env.REDIS_URL
  if (redisUrl === undefined) {
    throw new Error('Missing env: REDIS_URL')
  }

  const redisClient = new Redis(redisUrl)
  const redisBlockingClient = new Redis(redisUrl)

  const queue = new Queue(redisClient, redisBlockingClient)

  const tip = await rpcClient.getBlockNumber()
  const lastProcessed = await database.getLatest()
  await queue.seed(tip, lastProcessed)

  setInterval(async () => {
    try {
      const tip = await rpcClient.getBlockNumber()
      const lastProcessed = await database.getLatest()
      await queue.seed(tip, lastProcessed)
    } catch (err) {
      console.error('Seeder failed:', err)
    }
  }, 10000)

  setInterval(async () => {
    try {
      await queue.recoverZombies()
    } catch (err) {
      console.error('Janitor failed:', err)
    }
  }, 10000)
}

main().catch((e: unknown) => {
  console.error(e)
})
