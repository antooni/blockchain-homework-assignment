import { type Block, type Client, type Transaction, type TransactionReceipt, toHex } from 'viem'
import type { Queue } from './Queue'
import type { BlockRecord, GetBlockReceiptsSchema, LogRecord, TransactionRecord } from './types'

export class Fetcher {
  constructor(
    private client: Client,
    private queue: Queue, // Injected for Rate Limiting
    private options: {
      rpcCallsPerSecond: number
      maxRetries: number
    },
  ) {}

  /**
   * Helper: Spins until a Rate Limit token is acquired.
   * This handles the "Backoff" logic for the Rate Limiter specifically.
   */
  private async waitForToken() {
    let allowed = false
    while (!allowed) {
      // Ask Redis: "Can I make 1 call?"
      allowed = await this.queue.acquireToken(this.options.rpcCallsPerSecond)
      if (!allowed) {
        // If rejected, sleep for a random short interval (jitter) to desynchronize
        const jitter = Math.floor(Math.random() * 200) + 50
        await sleep(jitter)
      }
    }
  }

  /**
   * Fetches and transforms a single block with retry logic.
   * Retries handle transient network errors without failing the entire batch.
   */
  async fetch(blockNumber: bigint) {
    let attempt = 0
    while (attempt < this.options.maxRetries) {
      try {
        attempt++
        return await this.fetchInternal(blockNumber)
      } catch {
        // If it's the last attempt, throw to propagate the error
        if (attempt >= this.options.maxRetries) {
          throw new Error(`Block ${blockNumber} failed after ${this.options.maxRetries} attempts`)
        }

        // Exponential backoff with jitter to recover from rate limits/timeouts
        const delay = Math.pow(2, attempt) * 500 + Math.floor(Math.random() * 500)
        await sleep(delay)
      }
    }
  }

  /**
   * Internal fetch implementation without retry logic.
   */
  private async fetchInternal(blockNumber: bigint) {
    const hexNumber = toHex(blockNumber)

    // 1. Prepare Tasks with Rate Limiting
    // We wrap the request in a function that first ensures we have a token.
    // This allows Promise.all to execute them as soon as tokens are available.

    const blockTask = (async () => {
      await this.waitForToken() // Cost: 1 call
      return this.client.request({
        method: 'eth_getBlockByNumber',
        params: [hexNumber, true],
      }) as Promise<Block>
    })()

    const receiptsTask = (async () => {
      await this.waitForToken() // Cost: 1 call
      return this.client.request<GetBlockReceiptsSchema>({
        method: 'eth_getBlockReceipts',
        params: [hexNumber],
      }) as Promise<TransactionReceipt[]>
    })()

    // 2. Execute in Parallel
    const [block, receipts] = await Promise.all([blockTask, receiptsTask])

    if (!block) throw new Error(`Block ${blockNumber} not found`)

    // 3. Transform
    return transformData(block, receipts)
  }
}

// biome-ignore lint: we do not handle pending blocks
const bigIntToStr = (v: bigint | number | null) => v!.toString()
const toDate = (hex: bigint) => new Date(Number(hex) * 1000)

export function transformData(block: Block, receipts: TransactionReceipt[]) {
  assert(block.hash && block.nonce && block.logsBloom)

  const blockRecord: BlockRecord = {
    number: bigIntToStr(block.number),
    hash: block.hash,
    parent_hash: block.parentHash,
    nonce: block.nonce,
    sha3_uncles: block.sha3Uncles,
    timestamp: toDate(block.timestamp),
    miner: block.miner,
    extra_data: block.extraData,
    size: bigIntToStr(block.size),
    gas_limit: bigIntToStr(block.gasLimit),
    gas_used: bigIntToStr(block.gasUsed),
    difficulty: bigIntToStr(block.difficulty),
    base_fee_per_gas: block.baseFeePerGas ? bigIntToStr(block.baseFeePerGas) : null,
    state_root: block.stateRoot,
    receipts_root: block.receiptsRoot,
    transactions_root: block.transactionsRoot,
    logs_bloom: block.logsBloom,
  }

  const receiptMap = new Map(receipts.map((r) => [r.transactionHash, r]))

  const txRecords: TransactionRecord[] = []
  const logRecords: LogRecord[] = []

  for (const tx of block.transactions as Transaction[]) {
    assert(tx.hash && tx.blockHash)

    const receipt = receiptMap.get(tx.hash)
    if (!receipt) throw new Error(`Missing receipt for tx ${tx.hash}`)

    // Safe Property Access (Type Guarding)
    const maxFeePerGas = 'maxFeePerGas' in tx ? (tx.maxFeePerGas ?? null) : null
    const maxPriorityFeePerGas =
      'maxPriorityFeePerGas' in tx ? (tx.maxPriorityFeePerGas ?? null) : null

    txRecords.push({
      hash: tx.hash,
      nonce: bigIntToStr(tx.nonce),
      block_hash: block.hash,
      block_number: bigIntToStr(tx.blockNumber),
      transaction_index: Number(tx.transactionIndex),
      from_address: tx.from,
      to_address: tx.to,
      value: bigIntToStr(tx.value),
      gas: bigIntToStr(tx.gas),
      gas_price: bigIntToStr(tx.gasPrice ?? 0n),
      input: tx.input,
      v: bigIntToStr(tx.v),
      r: tx.r,
      s: tx.s,

      type: tx.type ? Number(tx.type) : 0,
      max_fee_per_gas: bigIntToStr(maxFeePerGas),
      max_priority_fee_per_gas: bigIntToStr(maxPriorityFeePerGas),

      contract_address: receipt.contractAddress ?? null,
      effective_gas_price: bigIntToStr(receipt.effectiveGasPrice),
      receipt_status: Number(receipt.status),
      cumulative_gas_used: bigIntToStr(receipt.cumulativeGasUsed),
      block_timestamp: toDate(block.timestamp),
    })

    for (const log of receipt.logs) {
      logRecords.push({
        transaction_hash: log.transactionHash,
        log_index: Number(log.logIndex),
        transaction_index: Number(log.transactionIndex),
        block_hash: log.blockHash,
        block_number: bigIntToStr(log.blockNumber),
        address: log.address,
        data: log.data,
        removed: log.removed,
        topic0: log.topics[0] || null,
        topic1: log.topics[1] || null,
        topic2: log.topics[2] || null,
        topic3: log.topics[3] || null,
      })
    }
  }

  return { blockRecord, txRecords, logRecords }
}

function assert(condition: unknown, message?: string): asserts condition {
  if (!condition) {
    throw new Error(message ? `Assertion Error: ${message}` : 'Assertion Error')
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
