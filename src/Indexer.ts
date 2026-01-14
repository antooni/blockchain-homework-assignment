import type { Database } from './Database'
import type { Fetcher } from './Fetcher'

export class Indexer {
  constructor(
    private database: Database,
    private fetcher: Fetcher,
  ) {}

  async processRange(from: bigint, to: bigint) {}
}
