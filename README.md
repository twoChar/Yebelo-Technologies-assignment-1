CSV → ingest.js → trade-data → Rust RSI service → rsi-data → broadcaster → SSE/REST → dashboard charts.



docker compose up -d
docker ps

cd rsi-service
RUST_LOG=info \
BROKER=127.0.0.1:29092 \
TRADE_TOPIC=trade-data \
RSI_TOPIC=rsi-data \
cargo run --release

cd rsi-broadcaster
KAFKA_BROKER=127.0.0.1:29092 \
RSI_TOPIC=rsi-data \
PORT=4001 \
node server.js

npm run dev

KAFKA_BROKER=localhost:29092 node ingest.js