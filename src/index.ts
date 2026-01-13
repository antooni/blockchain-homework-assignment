import {
  type Block,
  type Client,
  createPublicClient,
  http,
  type TransactionReceipt,
  toHex,
} from 'viem'
import { anvil } from 'viem/chains'
import { saveBlockBatch } from './storage'
import { transformData } from './transformer'

async function main() {
  const client = createPublicClient({
    chain: anvil,
    transport: http(),
  })

  const tip = 24219023n

  // 2. Fetch
  const { block, receipts } = await fetchBlockData(client, tip)

  // 3. Transform
  const { blockRecord, txRecords, logRecords } = transformData(block, receipts)

  // 4. Save
  await saveBlockBatch([blockRecord], txRecords, logRecords)
}

type GetBlockReceiptsSchema = {
  Method: 'eth_getBlockReceipts'
  Parameters: [string] // The block number in hex
  ReturnType: TransactionReceipt[]
}

export async function fetchBlockData(client: Client, blockNumber: bigint) {
  const hexNumber = toHex(blockNumber)

  // 2. Parallel Requests: Get Block + Get All Receipts
  // We use raw 'request' to access eth_getBlockReceipts directly
  const [block, receipts] = await Promise.all([
    client.request({
      method: 'eth_getBlockByNumber',
      params: [hexNumber, true], // true = include full transactions
    }) as Promise<Block>,

    client.request<GetBlockReceiptsSchema>({
      method: 'eth_getBlockReceipts',
      params: [hexNumber],
    }) as Promise<TransactionReceipt[]>,
  ])

  if (!block) throw new Error(`Block ${blockNumber} not found`)

  return { block, receipts }
}

main().catch((e: unknown) => {
  console.error(e)
})
