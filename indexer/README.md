# Indexer Implementation

This directory is where you'll implement your blockchain indexer.

## Language Choice

You may use either **TypeScript** or **Go** for your implementation. Both are commonly used for blockchain infrastructure:

### TypeScript Setup
```bash
npm init -y
npm install --save-dev typescript @types/node tsx
npm install ioredis pg
npx tsc --init
```

### Go Setup
```bash
go mod init indexer
go get github.com/redis/go-redis/v9
go get github.com/lib/pq
```

## Getting Started

1. Initialize your project using one of the setups above
2. Implement the distributed indexer according to the specifications in the main `README.md`
3. Connect to the provided services:
   - Redis: `localhost:6379`
   - PostgreSQL: `localhost:5432`
   - RPC endpoint: See main `README.md` for options

## Key Components to Implement

- Work distribution and coordination (Redis)
- Rate limiting
- Retry logic with exponential backoff
- Progress persistence
- Data output to PostgreSQL with proper schema design
- Gap detection and recovery

Refer to the main `README.md` for detailed requirements.
