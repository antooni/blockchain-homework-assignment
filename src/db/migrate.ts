// src/db/migrate.ts
import fs from 'fs'
import path from 'path'
import { Pool } from 'pg'

// Config (or load from env)
const pool = new Pool({
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB,
})

async function migrate() {
  console.log(process.env.POSTGRES_DB)
  const client = await pool.connect()
  try {
    console.log('🔄 Starting database migration...')

    // 1. Read all files from the 'sql' folder
    const sqlDir = path.join(__dirname, '../../sql') // Adjust path to your root sql folder
    const files = fs
      .readdirSync(sqlDir)
      .filter((f) => f.endsWith('.sql'))
      .sort() // Sorts alphabetical: 00_, 01_, 02_...

    // 2. Execute each file sequentially
    for (const file of files) {
      const filePath = path.join(sqlDir, file)
      const sql = fs.readFileSync(filePath, 'utf8')

      console.log(`📜 Applying: ${file}`)

      // Execute
      await client.query('BEGIN')
      try {
        await client.query(sql)
        await client.query('COMMIT')
      } catch (err) {
        await client.query('ROLLBACK')
        console.error(`❌ Failed to apply ${file}`)
        throw err
      }
    }

    console.log('✅ All migrations applied successfully.')
  } catch (error) {
    console.error('Migration failed:', error)
    process.exit(1)
  } finally {
    client.release()
    await pool.end()
  }
}

migrate()
