import type { Block, Transaction, TransactionReceipt } from 'viem'
import type { BlockRecord, LogRecord, TransactionRecord } from './types'

// biome-ignore lint: we do not handle pending blocks
const bigIntToStr = (v: bigint | number | null) => v!.toString()
const toDate = (hex: bigint) => new Date(Number(hex) * 1000)

export function transformData(block: Block, receipts: TransactionReceipt[]) {
  assert(block.hash && block.nonce && block.logsBloom)

  // 1. Map Block
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

  // Create a Map for fast Receipt lookup by Tx Hash
  const receiptMap = new Map(receipts.map((r) => [r.transactionHash, r]))

  const txRecords: TransactionRecord[] = []
  const logRecords: LogRecord[] = []

  // 2. Iterate Transactions and Merge with Receipts
  for (const tx of block.transactions as Transaction[]) {
    const receipt = receiptMap.get(tx.hash)
    if (!receipt) throw new Error(`Missing receipt for tx ${tx.hash}`)

    const maxFeePerGas = 'maxFeePerGas' in tx ? tx.maxFeePerGas : null
    const maxPriorityFeePerGas = 'maxPriorityFeePerGas' in tx ? tx.maxPriorityFeePerGas : null

    // Transform Transaction
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
      gas_price: tx.gasPrice?.toString() ?? '0x',
      input: tx.input,
      v: bigIntToStr(tx.v),
      r: tx.r,
      s: tx.s,

      // Fields from Receipt / EIP-1559
      type: tx.type ? Number(tx.type) : 0,
      max_fee_per_gas: maxFeePerGas?.toString() ?? null,
      max_priority_fee_per_gas: maxPriorityFeePerGas?.toString() ?? null,

      // Receipt Merging
      contract_address: receipt.contractAddress ?? null,
      effective_gas_price: bigIntToStr(receipt.effectiveGasPrice),
      receipt_status: Number(receipt.status),
      cumulative_gas_used: bigIntToStr(receipt.cumulativeGasUsed),
      block_timestamp: toDate(block.timestamp), // Denormalized time
    })

    // 3. Transform Logs (Flattened from Receipt)
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
