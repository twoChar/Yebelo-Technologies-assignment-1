twochar@twochars-MacBook-Air assignment-1 % docker exec -it redpanda rpk topic consume trade-data --brokers redpanda:9092 --offset start -n 5


twochar@twochars-MacBook-Air ingest % KAFKA_BROKER=127.0.0.1:29092 node ingest.js





twochar@twochars-MacBook-Air rsi-service % BROKER=127.0.0.1:29092 \
TRADE_TOPIC=trade-data \
RSI_TOPIC=rsi-data \
GROUP_ID=rsi-service-$(date +%s) \
cargo run

    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.12s
     Running `target/debug/rsi-service`




twochar@twochars-MacBook-Air rsi-broadcaster % KAFKA_BROKER=localhost:29092 node server.js





docker exec -it redpanda rpk topic consume rsi-data --brokers redpanda:9092 --offset start
cd rsi-broadcaster
KAFKA_BROKER=localhost:29092 PORT=4001 node server.js
twochar@twochars-MacBook-Air assignment-1 % curl http://localhost:4001/api/latest-rsi | jq .
twochar@twochars-MacBook-Air assignment-1 % curl -N http://localhost:4001/events





CSV → ingest.js → trade-data → Rust RSI service → rsi-data → broadcaster → SSE/REST → dashboard charts.