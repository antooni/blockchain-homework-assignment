CREATE TABLE transactions (
    -- 1. Identifiers
    hash             TEXT PRIMARY KEY,      -- "hash"
    nonce            BIGINT NOT NULL,       -- "nonce" (Ordered counter, fits in int64)
    block_hash       TEXT NOT NULL,         -- "blockHash"
    block_number     BIGINT NOT NULL REFERENCES blocks(number) ON DELETE CASCADE, -- "blockNumber"
    transaction_index INT NOT NULL,         -- "transactionIndex"

    -- 2. Addresses
    from_address     TEXT NOT NULL,         -- "from"
    to_address       TEXT,                  -- "to" (Null for contract creation)
    contract_address    TEXT,               -- From Receipt. The created contract address, handy for analytics

    -- 3. Economics (Strict Numeric)
    value            NUMERIC(78, 0) NOT NULL, -- "value"
    gas              NUMERIC(78, 0) NOT NULL, -- "gas" (Gas Limit)
    gas_price        NUMERIC(78, 0) NOT NULL, -- "gasPrice"
    effective_gas_price NUMERIC(78, 0),       -- From Receipt. The actual price paid.
    -- EIP-1559 Fields (Nullable)
    max_fee_per_gas         NUMERIC(78, 0), -- "maxFeePerGas"
    max_priority_fee_per_gas NUMERIC(78, 0),-- "maxPriorityFeePerGas"

    -- 4. Data
    input            TEXT NOT NULL,         -- "input"

    -- 5. Type & V/R/S (Signatures)
    type             INT NOT NULL,                   -- "type" (0x0, 0x1, 0x2)
    v                TEXT NOT NULL,                  -- "v"
    r                TEXT NOT NULL,                  -- "r"
    s                TEXT NOT NULL,                  -- "s"

    -- 6. Denormalized Time
    block_timestamp  TIMESTAMPTZ NOT NULL, -- Saves a JOIN on every time-based query

    -- 7. Receipt Status (From eth_getBlockReceipts)
    receipt_status   INT,                   -- 1 = Success, 0 = Fail
    cumulative_gas_used NUMERIC(78, 0)      -- From receipt
);
