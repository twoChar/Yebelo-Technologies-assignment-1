use anyhow::Result;
use futures::StreamExt;
use log::{error, info};
use rdkafka::consumer::{CommitMode, StreamConsumer};
use rdkafka::message::{BorrowedMessage, Message};
use rdkafka::producer::{FutureProducer, FutureRecord};
use rdkafka::{ClientConfig, TopicPartitionList};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, VecDeque};
use std::env;
use std::time::{SystemTime, UNIX_EPOCH};
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

/// compute 14-period RSI using standard (Wilder-ish) SMA over the last (period+1) prices.
/// returns None if not enough prices.
fn compute_rsi_from_prices(prices: &VecDeque<f64>, period: usize) -> Option<f64> {
    // Need at least period + 1 prices to compute period deltas
    if prices.len() < period + 1 {
        return None;
    }
    // use the most recent (period + 1) prices
    let mut deltas = Vec::with_capacity(period);
    let start = prices.len() - (period + 1);
    let slice: Vec<f64> = prices
        .iter()
        .skip(start)
        .cloned()
        .collect();

    for i in 1..slice.len() {
        deltas.push(slice[i] - slice[i - 1]);
    }

    // compute average gain and loss (simple moving average of gains/losses)
    let mut gain_sum = 0.0;
    let mut loss_sum = 0.0;
    for d in deltas {
        if d > 0.0 {
            gain_sum += d;
        } else {
            loss_sum += -d;
        }
    }
    let avg_gain = gain_sum / (period as f64);
    let avg_loss = loss_sum / (period as f64);

    // avoid division by zero
    let rs = if avg_loss == 0.0 {
        // If avg_loss is 0, RSI is 100 (no losses)
        return Some(100.0);
    } else {
        avg_gain / avg_loss
    };

    let rsi = 100.0 - (100.0 / (1.0 + rs));
    Some(rsi)
}

fn parse_price_from_payload(payload: &str) -> Option<(String, f64)> {
    // Expect payload to be JSON (the same we produced from CSV).
    // We'll look for "token_address" and "price_in_sol" fields.
    match serde_json::from_str::<Value>(payload) {
        Ok(v) => {
            let token = v
                .get("token_address")
                .and_then(|t| t.as_str())
                .map(|s| s.to_string());

            // try a couple of field names for price for resilience
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

    info!("Starting RSI service. broker={} trade_topic={} rsi_topic={} period={}", broker, trade_topic, rsi_topic, period);

    // create consumer
    let consumer: StreamConsumer = ClientConfig::new()
        .set("bootstrap.servers", &broker)
        .set("group.id", "rsi-service-group")
        .set("enable.auto.commit", "false")
        .set("auto.offset.reset", "earliest")
        .create()?;

    // subscribe to trade topic
    consumer.subscribe(&[&trade_topic])?;

    // create producer (FutureProducer)
    let producer: FutureProducer = ClientConfig::new()
        .set("bootstrap.servers", &broker)
        .create()?;

    // history per token
    let mut history: HashMap<String, VecDeque<f64>> = HashMap::new();

    // consumer message stream
    let mut message_stream = consumer.stream();

    // also handle shutdown signal gracefully
    let mut sig = signal::ctrl_c();

    loop {
        tokio::select! {
            maybe_msg = message_stream.next() => {
                match maybe_msg {
                    Some(Ok(msg)) => {
                        if let Some(payload) = msg.payload_view::<str>().ok().flatten() {
                            if let Some((token_addr, price)) = parse_price_from_payload(payload) {
                                let entry = history.entry(token_addr.clone()).or_insert_with(|| VecDeque::with_capacity(MAX_HISTORY));
                                entry.push_back(price);
                                if entry.len() > MAX_HISTORY {
                                    entry.pop_front();
                                }

                                // compute RSI when we have enough points
                                if let Some(rsi) = compute_rsi_from_prices(entry, period) {
                                    let rsi_msg = RsiMessage {
                                        token_address: token_addr.clone(),
                                        rsi,
                                        price,
                                        timestamp_ms: now_ms(),
                                    };
                                    let payload = serde_json::to_string(&rsi_msg)?;
                                    // send to rsi topic (async)
                                    let produce_future = producer.send(
                                        FutureRecord::to(&rsi_topic)
                                            .payload(&payload)
                                            .key(&token_addr),
                                        0
                                    );

                                    // spawn a tokio task to await the send result but don't block main loop
                                    tokio::spawn(async move {
                                        match produce_future.await {
                                            Ok(Ok(_delivery)) => {
                                                // delivered
                                            }
                                            Ok(Err((kafka_err, _message))) => {
                                                error!("Failed to deliver RSI message: {:?}", kafka_err);
                                            }
                                            Err(e) => {
                                                error!("Producer future cancelled/failed: {:?}", e);
                                            }
                                        }
                                    });
                                }
                            } else {
                                // couldn't parse payload; ignore or log
                                error!("Could not parse token/price from payload: {}", payload);
                            }
                        }

                        // commit the message offset (at-least-once)
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
            }

            _ = &mut sig => {
                info!("Shutdown signal received, exiting.");
                break;
            }
        }
    }

    info!("RSI service shutting down.");
    Ok(())
}
