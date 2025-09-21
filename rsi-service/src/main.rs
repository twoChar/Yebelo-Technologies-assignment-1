use anyhow::Result;
use futures::StreamExt;
use log::{error, info};
use rdkafka::consumer::{CommitMode, Consumer, StreamConsumer};
use rdkafka::message::Message;
use rdkafka::producer::{FutureProducer, FutureRecord};
use rdkafka::ClientConfig;
use serde::Serialize;
use serde_json::Value;
use std::collections::{HashMap, VecDeque};
use std::env;
use std::time::{SystemTime, UNIX_EPOCH, Duration};
use tokio::signal;

const DEFAULT_BROKER: &str = "localhost:29092";
const DEFAULT_TRADE_TOPIC: &str = "trade-data";
const DEFAULT_RSI_TOPIC: &str = "rsi-data";
const DEFAULT_PERIOD: usize = 14;
const MAX_HISTORY: usize = 200; // keep recent prices per token (memory bound)

#[derive(Debug, Serialize)]
struct RsiMessage {
    token_address: String,
    rsi: f64,
    price: f64,
    timestamp_ms: u128,
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or_default()
}

/// compute RSI using simple (Wilder-ish) SMA over last (period + 1) prices.
/// returns None if not enough prices.
fn compute_rsi_from_prices(prices: &VecDeque<f64>, period: usize) -> Option<f64> {
    if prices.len() < period + 1 {
        return None;
    }

    let start = prices.len() - (period + 1);
    let slice: Vec<f64> = prices.iter().skip(start).cloned().collect();

    let mut gain_sum = 0.0;
    let mut loss_sum = 0.0;

    for i in 1..slice.len() {
        let d = slice[i] - slice[i - 1];
        if d > 0.0 {
            gain_sum += d;
        } else {
            loss_sum += -d;
        }
    }

    let avg_gain = gain_sum / (period as f64);
    let avg_loss = loss_sum / (period as f64);

    if avg_loss == 0.0 {
        return Some(100.0);
    }

    let rs = avg_gain / avg_loss;
    let rsi = 100.0 - (100.0 / (1.0 + rs));
    Some(rsi)
}

/// try to extract (token_address, price) from a JSON payload string
fn parse_price_from_payload(payload: &str) -> Option<(String, f64)> {
    match serde_json::from_str::<Value>(payload) {
        Ok(v) => {
            let token = v
                .get("token_address")
                .and_then(|t| t.as_str())
                .map(|s| s.to_string());

            let price_field_candidates = ["price_in_sol", "price", "price_sol", "amount_in_sol"];
            let mut price_opt: Option<f64> = None;

            for field in price_field_candidates.iter() {
                if let Some(pv) = v.get(*field) {
                    if pv.is_string() {
                        if let Ok(parsed) = pv.as_str().unwrap_or_default().parse::<f64>() {
                            price_opt = Some(parsed);
                            break;
                        }
                    } else if pv.is_number() {
                        price_opt = pv.as_f64();
                        break;
                    }
                }
            }

            if let (Some(token_addr), Some(price)) = (token, price_opt) {
                Some((token_addr, price))
            } else {
                None
            }
        }
        Err(_) => None,
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    env_logger::init();

    let broker = env::var("BROKER").unwrap_or_else(|_| DEFAULT_BROKER.to_string());
    let trade_topic = env::var("TRADE_TOPIC").unwrap_or_else(|_| DEFAULT_TRADE_TOPIC.to_string());
    let rsi_topic = env::var("RSI_TOPIC").unwrap_or_else(|_| DEFAULT_RSI_TOPIC.to_string());
    let period: usize = env::var("RSI_PERIOD")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(DEFAULT_PERIOD);

    info!(
        "Starting RSI service. broker={} trade_topic={} rsi_topic={} period={}",
        broker, trade_topic, rsi_topic, period
    );

    let group_id = std::env::var("GROUP_ID").unwrap_or_else(|_| "rsi-service".to_string());
    let auto_offset_reset = std::env::var("AUTO_OFFSET_RESET").unwrap_or_else(|_| "earliest".to_string());

    // Create a stream consumer using env vars (no duplicate keys)
    let consumer: StreamConsumer = ClientConfig::new()
        .set("bootstrap.servers", &broker)
        .set("group.id", &group_id)
        .set("auto.offset.reset", &auto_offset_reset)
        .set("enable.auto.commit", "false")
        // resilience tweaks
        .set("session.timeout.ms", "30000")
        .set("heartbeat.interval.ms", "10000")
        .set("request.timeout.ms", "600000")
        .set("reconnect.backoff.ms", "1000")
        .set("reconnect.backoff.max.ms", "10000")
        .set("socket.keepalive.enable", "true")
        .create()?;


    // Subscribe to trade topic
    consumer.subscribe(&[&trade_topic])?;

    // FutureProducer (async producer)
    let producer: FutureProducer = ClientConfig::new()
        .set("bootstrap.servers", &broker)
        .set("message.timeout.ms", "600000")
        .set("retries", "5")
        .set("retry.backoff.ms", "1000")
        .create()?;


    // per-token history buffer
    let mut history: HashMap<String, VecDeque<f64>> = HashMap::new();

    // message stream
    let mut message_stream = consumer.stream();

    // ctrl-c signal future (pinned so tokio::select! can use &mut)
    let sig = signal::ctrl_c();
    tokio::pin!(sig);

    loop {
        tokio::select! {
            maybe_msg = message_stream.next() => {
                match maybe_msg {
                    Some(Ok(msg)) => {
                        // payload_view returns Option<Result<&str, Utf8Error>> for this rdkafka version
                        match msg.payload_view::<str>() {
                            Some(Ok(payload)) => {
                                if let Some((token_addr, price)) = parse_price_from_payload(payload) {
                                    let entry = history.entry(token_addr.clone()).or_insert_with(|| VecDeque::with_capacity(MAX_HISTORY));
                                    entry.push_back(price);
                                    if entry.len() > MAX_HISTORY {
                                        entry.pop_front();
                                    }

                                    if let Some(rsi) = compute_rsi_from_prices(entry, period) {
                                        let rsi_msg = RsiMessage {
                                            token_address: token_addr.clone(),
                                            rsi,
                                            price,
                                            timestamp_ms: now_ms(),
                                        };

                                        // Serialize payload now (owned String)
                                        let payload_string = match serde_json::to_string(&rsi_msg) {
                                            Ok(s) => s,
                                            Err(e) => {
                                                error!("Failed to serialize RSI message: {:?}", e);
                                                continue;
                                            }
                                        };

                                        // CLONE or move owned values into the spawned task so they are 'static
                                        // FutureProducer implements Clone (cheap), String clones are owned.
                                        let producer_cloned = producer.clone();
                                        let rsi_topic_cloned = rsi_topic.clone();
                                        let token_cloned = token_addr.clone();
                                        let payload_cloned = payload_string; // move ownership

                                        // spawn task that owns everything it needs
                                        tokio::spawn(async move {
                                            let produce_future = producer_cloned.send(
                                                FutureRecord::to(&rsi_topic_cloned)
                                                    .payload(&payload_cloned)
                                                    .key(&token_cloned),
                                                Some(Duration::from_secs(5)),
                                            );

                                            match produce_future.await {
                                                Ok((partition, offset)) => {
                                                    info!("RSI message delivered to partition {} offset {}", partition, offset);
                                                }
                                                Err((kafka_err, _owned_msg)) => {
                                                    error!("Failed to deliver RSI message: {:?}", kafka_err);
                                                }
                                            }
                                        });
                                    }
                                } else {
                                    error!("Could not parse token/price from payload: {}", payload);
                                }
                            }
                            Some(Err(e)) => {
                                error!("Payload present but not valid UTF-8: {:?}", e);
                            }
                            None => {
                                // no payload
                            }
                        }

                        // commit offset (at least once)
                        if let Err(e) = consumer.commit_message(&msg, CommitMode::Async) {
                            error!("Failed to commit message: {:?}", e);
                        }
                    }
                    Some(Err(e)) => {
                        error!("Kafka error while consuming: {:?}", e);
                    }
                    None => {
                        info!("Consumer stream ended.");
                        break;
                    }
                }
            },

            // graceful shutdown
            _ = &mut sig => {
                info!("Shutdown signal received, exiting.");
                break;
            }
        }
    }

    info!("RSI service shutting down.");
    Ok(())
}
