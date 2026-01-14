// Type alias for fields stored as NUMERIC or BIGINT in Postgres

import type { TransactionReceipt } from 'viem'

// We handle them as strings in JS to preserve 256-bit precision.
type StringNumber = string

// Type alias for fields stored as TIMESTAMPTZ
// The pg driver automatically parses these into JS Date objects.
type DBDate = Date

/**
 * Corresponds to the 'blocks' table
 */
export interface BlockRecord {
  // Identifiers
  number: StringNumber // PK, BigInt
  hash: string // Text
  parent_hash: string
  nonce: string
  sha3_uncles: string

  // Metadata & Time
  timestamp: DBDate
  miner: string
  extra_data: string
  size: StringNumber

  // Gas & Economics
  gas_limit: StringNumber
  gas_used: StringNumber
  difficulty: StringNumber
  base_fee_per_gas: StringNumber | null // Nullable (pre-EIP-1559)

  // Roots & Blooms
  state_root: string
  receipts_root: string
  transactions_root: string
  logs_bloom: string
}

/**
 * Corresponds to the 'transactions' table
 */
export interface TransactionRecord {
  // Identifiers
  hash: string // PK
  nonce: StringNumber
  block_hash: string
  block_number: StringNumber // FK
  transaction_index: number // Int

  // Addresses
  from_address: string
  to_address: string | null // Null for contract creation
  contract_address: string | null // From Receipt

  // Economics
  value: StringNumber
  gas: StringNumber
  gas_price: StringNumber
  effective_gas_price: StringNumber | null // From Receipt

  // EIP-1559
  max_fee_per_gas: StringNumber | null
  max_priority_fee_per_gas: StringNumber | null

  // Data & Type
  input: string
  type: number | null

  // Signatures
  v: StringNumber
  r: StringNumber
  s: StringNumber

  // Denormalized
  block_timestamp: DBDate
  receipt_status: number | null // 0 or 1
  cumulative_gas_used: StringNumber | null
}

/**
 * Corresponds to the 'logs' table
 */
export interface LogRecord {
  // PK Composite (transaction_hash, log_index)
  transaction_hash: string
  log_index: number

  // Pointers
  transaction_index: number
  block_hash: string
  block_number: StringNumber

  // Event Data
  address: string
  data: string
  removed: boolean

  // Topics
  topic0: string | null
  topic1: string | null
  topic2: string | null
  topic3: string | null
}

export type GetBlockReceiptsSchema = {
  Method: 'eth_getBlockReceipts'
  Parameters: [string]
  ReturnType: TransactionReceipt[]
}
