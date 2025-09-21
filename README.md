twochar@twochars-MacBook-Air ingest % KAFKA_BROKER=127.0.0.1:29092 node ingest.js


twochar@twochars-MacBook-Air rsi-service % BROKER=127.0.0.1:29092 \
TRADE_TOPIC=trade-data \
RSI_TOPIC=rsi-data \
GROUP_ID=rsi-service-$(date +%s) \
cargo run

    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.12s
     Running `target/debug/rsi-service`




twochar@twochars-MacBook-Air rsi-broadcaster % KAFKA_BROKER=localhost:29092 node server.js

