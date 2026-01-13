CREATE TABLE logs (
    -- 1. Identifiers (Composite Primary Key)
    transaction_hash  TEXT NOT NULL REFERENCES transactions(hash) ON DELETE CASCADE, -- "transactionHash"
    log_index         INT NOT NULL,           -- "logIndex"

    -- 2. Pointers
    transaction_index INT NOT NULL,           -- "transactionIndex"
    block_hash        TEXT NOT NULL,          -- "blockHash"
    block_number      BIGINT NOT NULL REFERENCES blocks(number) ON DELETE CASCADE, -- "blockNumber"

    -- 3. Event Data
    address           TEXT NOT NULL,          -- "address" (The contract emitting the event)
    data              TEXT NOT NULL,          -- "data" (Non-indexed arguments)
    removed           BOOLEAN NOT NULL DEFAULT FALSE, -- "removed" (It is true when the log was removed due to a chain reorganization, and false if it's a valid log)

    -- 4. Flattened Topics (From "topics" Array)
    topic0            TEXT,                   -- Event Signature
    topic1            TEXT,                   -- Indexed Argument 1
    topic2            TEXT,                   -- Indexed Argument 2
    topic3            TEXT,                   -- Indexed Argument 3

    PRIMARY KEY (transaction_hash, log_index)
);
