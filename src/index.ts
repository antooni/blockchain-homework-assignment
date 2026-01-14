import Redis from 'ioredis'
import { Pool } from 'pg'
import { createPublicClient, http } from 'viem'
import { anvil } from 'viem/chains'
import { Database } from './Database'
import { Fetcher } from './Fetcher'
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

  const fetcher = new Fetcher(rpcClient)

  const redisUrl = process.env.REDIS_URL
  if (redisUrl === undefined) {
    throw new Error('Missing env: REDIS_URL')
  }

  const redisClient = new Redis(redisUrl)
  const redisBlockingClient = new Redis(redisUrl)

  const queue = new Queue(redisClient, redisBlockingClient)

  const tip = 24219023n

  const { blockRecord, txRecords, logRecords } = await fetcher.fetch(tip)

  await database.save([blockRecord], txRecords, logRecords)

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
