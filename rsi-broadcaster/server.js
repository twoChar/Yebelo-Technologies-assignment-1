// server.js
// RSI broadcaster: consumes rsi-data topic and exposes:
//  - GET /api/latest-rsi   -> current snapshot array
//  - GET /events           -> SSE stream of incoming RSI events
//
// Env:
//  KAFKA_BROKER (default: localhost:29092)
//  RSI_TOPIC   (default: rsi-data)
//  PORT        (default: 4000)
//  GROUP_ID    (optional) unique consumer group id; defaults to timestamp-based id (for replay)

const express = require('express');
const cors = require('cors');
const { Kafka } = require('kafkajs');

const PORT = process.env.PORT || process.env.BROADCASTER_PORT || 4001;
const BROKER = process.env.KAFKA_BROKER || 'localhost:29092';
const RSI_TOPIC = process.env.RSI_TOPIC || 'rsi-data';
const GROUP_ID = process.env.GROUP_ID || `rsi-broadcaster-${Date.now()}`;

const kafka = new Kafka({
  clientId: 'rsi-broadcaster',
  brokers: [BROKER],
  connectionTimeout: 30000, // default often 1000-3000
  requestTimeout: 300000,   // 5 minutes
});
const consumer = kafka.consumer({ groupId: GROUP_ID, sessionTimeout: 30000 });

const app = express();
app.use(cors());
app.use(express.json());

// In-memory store: latest per token_address
const latest = {}; // { tokenAddress: { rsi, price, timestamp_ms } }

// SSE clients set
const clients = new Set();

// utility to send SSE payload to all clients
function broadcastSse(payloadObj) {
  const payload = `data: ${JSON.stringify(payloadObj)}\n\n`;
  for (const res of clients) {
    try {
      res.write(payload);
    } catch (err) {
      console.error('Failed to write SSE to client:', err);
    }
  }
}

// API: snapshot of latest RSIs
app.get('/api/latest-rsi', (req, res) => {
  const snapshot = Object.entries(latest).map(([token, payload]) => ({
    token,
    ...payload,
  }));
  res.json({ snapshot });
});

// SSE endpoint
app.get('/events', (req, res) => {
  // headers for SSE
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  // send a comment/heartbeat so clients know connection is open
  res.write(': connected\n\n');

  clients.add(res);
  console.log(`SSE client connected (total: ${clients.size})`);

  // remove client when connection closed
  req.on('close', () => {
    clients.delete(res);
    console.log(`SSE client disconnected (total: ${clients.size})`);
  });
});

// Start express server
const server = app.listen(PORT, async () => {
  console.log(`RSI broadcaster listening on http://localhost:${PORT}`);
  try {
    await runConsumer();
  } catch (err) {
    console.error('Failed to start Kafka consumer:', err);
    process.exit(1);
  }
});

// Kafka consumer runner
async function runConsumer() {
  console.log(`Connecting Kafka consumer to broker ${BROKER} with groupId ${GROUP_ID}...`);
  await consumer.connect();
  // for testing we subscribe from beginning so historical RSI messages are consumed.
  // Set fromBeginning: false for production live-only consumption.
  await consumer.subscribe({ topic: RSI_TOPIC, fromBeginning: true });
  console.log(`Kafka consumer subscribed to topic ${RSI_TOPIC} (fromBeginning=true)`);

  await consumer.run({
    // eachMessage will be called concurrently for multiple partitions;
    // keep it small & non-blocking. We do lightweight processing here.
    eachMessage: async ({ topic, partition, message }) => {
      try {
        const raw = message.value && message.value.toString();
        if (!raw) return;

        console.log('Received from Kafka:', raw);

        let parsed;
        try {
          parsed = JSON.parse(raw);
        } catch (err) {
          console.error('Failed to JSON.parse message value:', err, 'raw:', raw);
          return;
        }

        // normalize token key
        const token =
          parsed.token_address ||
          parsed.token ||
          parsed.tokenAddress ||
          parsed.tokenAddr ||
          'unknown';

        // ensure rsi/price/timestamp fields exist
        const rsi = typeof parsed.rsi === 'number' ? parsed.rsi : parseFloat(parsed.rsi);
        const price =
          typeof parsed.price === 'number'
            ? parsed.price
            : parsed.price_in_sol
            ? parseFloat(parsed.price_in_sol)
            : parsed.price
            ? parseFloat(parsed.price)
            : undefined;
        const timestamp_ms = parsed.timestamp_ms || Date.now();

        // store latest (guard basic types)
        latest[token] = {
          rsi: isNaN(rsi) ? null : rsi,
          price: isNaN(price) ? null : price,
          timestamp_ms,
        };

        // prepare payload and broadcast
        const payload = { token, ...latest[token] };
        broadcastSse(payload);
      } catch (err) {
        console.error('Error handling Kafka message:', err);
      }
    },
  });
}

// Graceful shutdown
async function shutdown() {
  console.log('Shutting down broadcaster...');
  try {
    // close express server (stop accepting new connections)
    server.close(() => console.log('HTTP server closed.'));
    // close SSE clients
    for (const res of clients) {
      try {
        res.end();
      } catch (e) {}
    }
    clients.clear();

    // disconnect consumer
    try {
      await consumer.disconnect();
      console.log('Kafka consumer disconnected.');
    } catch (e) {
      console.warn('Error while disconnecting consumer:', e);
    }
  } finally {
    process.exit(0);
  }
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// also catch unhandled rejections to avoid silent failures
process.on('unhandledRejection', (err) => {
  console.error('UnhandledRejection:', err);
});
