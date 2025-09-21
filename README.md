
## Demo Video
[Demo Video](https://youtu.be/VGV9GhaxoCY)




CSV → ingest.js → trade-data → Rust RSI service → rsi-data → broadcaster → SSE/REST → dashboard charts.





# T1
docker compose up -d
docker ps

# T2
cd rsi-service \
RUST_LOG=info \
BROKER=127.0.0.1:29092 \
TRADE_TOPIC=trade-data \
RSI_TOPIC=rsi-data \
cargo run --release

# T3
cd rsi-broadcaster \
KAFKA_BROKER=127.0.0.1:29092 \
RSI_TOPIC=rsi-data \
PORT=4001 \
node server.js

# T4
cd next-dashboard \
npm run dev

# T5
cd ingest \
KAFKA_BROKER=localhost:29092 node ingest.js