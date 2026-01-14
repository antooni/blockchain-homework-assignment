import { Pool } from 'pg'
import { createPublicClient, http } from 'viem'
import { anvil } from 'viem/chains'
import { Database } from './Database'
import { Fetcher } from './Fetcher'

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

  const client = createPublicClient({
    chain: anvil,
    transport: http(),
  })

  const fetcher = new Fetcher(client)

  const tip = 24219023n

  const { blockRecord, txRecords, logRecords } = await fetcher.fetch(tip)

  await database.save([blockRecord], txRecords, logRecords)
}

main().catch((e: unknown) => {
  console.error(e)
})
