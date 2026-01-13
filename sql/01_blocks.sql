CREATE TABLE blocks (
    -- 1. Identifiers
    number            BIGINT PRIMARY KEY,     -- "number"
    hash              TEXT NOT NULL UNIQUE,   -- "hash"
    parent_hash       TEXT NOT NULL,          -- "parentHash"
    nonce             TEXT NOT NULL,          -- "nonce" (Guaranteed defined for mined blocks)
    sha3_uncles       TEXT NOT NULL,          -- "sha3Uncles"

    -- 2. Metadata & Time
    timestamp         TIMESTAMPTZ NOT NULL,   -- "timestamp"
    miner             TEXT NOT NULL,          -- "miner"
    extra_data        TEXT NOT NULL,          -- "extraData"
    size              NUMERIC(78, 0) NOT NULL,-- "size"

    -- 3. Gas & Economics
    gas_limit         NUMERIC(78, 0) NOT NULL,-- "gasLimit"
    gas_used          NUMERIC(78, 0) NOT NULL,-- "gasUsed"
    difficulty        NUMERIC(78, 0) NOT NULL,-- "difficulty"
    base_fee_per_gas  NUMERIC(78, 0),         -- "baseFeePerGas", this field will not be included in a block requested before the EIP-1559 upgrade

    -- 4. Roots & Blooms
    state_root        TEXT NOT NULL,          -- "stateRoot"
    receipts_root     TEXT NOT NULL,          -- "receiptsRoot"
    transactions_root TEXT NOT NULL,          -- "transactionsRoot"
    logs_bloom        TEXT NOT NULL          -- "logsBloom"
);
