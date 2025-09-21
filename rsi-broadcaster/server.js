// server.js
// RSI broadcaster: consumes rsi-data topic and exposes:
//  - GET /api/latest-rsi   -> current snapshot array
//  - GET /events           -> SSE stream of incoming RSI events
//
// Env:
//  KAFKA_BROKER (default: localhost:29092)
//  RSI_TOPIC   (default: rsi-data)
//  PORT        (default: 4001)
//  GROUP_ID    (optional) unique consumer group id; defaults to timestamp-based id (for replay)
//  FROM_BEGINNING (optional) "true" or "false" (default "true" for testing)

const express = require('express');
const cors = require('cors');
const { Kafka } = require('kafkajs');

const PORT = process.env.PORT || process.env.BROADCASTER_PORT || 4001;
const BROKER = process.env.KAFKA_BROKER || 'localhost:29092';
const RSI_TOPIC = process.env.RSI_TOPIC || 'rsi-data';
const GROUP_ID = process.env.GROUP_ID || `rsi-broadcaster-${Date.now()}`;
const FROM_BEGINNING = (process.env.FROM_BEGINNING || 'true').toLowerCase() === 'true';

const kafka = new Kafka({
  clientId: 'rsi-broadcaster',
  brokers: [BROKER],
  connectionTimeout: 30000,
  requestTimeout: 300000,
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
  // send a connected comment
  res.write(': connected\n\n');

  // send the entire snapshot once so dashboard gets immediate data
  try {
    const snapshot = Object.entries(latest).map(([token, payload]) => ({ token, ...payload }));
    if (snapshot.length) {
      // single message with explicit type so clients can seed their state
      res.write(`data: ${JSON.stringify({ type: 'snapshot', snapshot })}\n\n`);
    }
  } catch (err) {
    console.error('Failed to send initial snapshot to SSE client:', err);
  }

  clients.add(res);
  console.log(`SSE client connected (total: ${clients.size})`);

  // heartbeat: send comment every 25s so proxies don't drop connection
  const heartbeat = setInterval(() => {
    try {
      res.write(': heartbeat\n\n');
    } catch (e) {
      // ignore
    }
  }, 25000);

  // clean up on client disconnect
  req.on('close', () => {
    clearInterval(heartbeat);
    clients.delete(res);
    console.log(`SSE client disconnected (total: ${clients.size})`);
  });
});

// Start express server and Kafka consumer
const server = app.listen(PORT, async () => {
  console.log(`RSI broadcaster listening on http://localhost:${PORT}`);
  try {
    await runConsumer();
  } catch (err) {
    console.error('Failed to start Kafka consumer:', err);
    process.exit(1);
  }
});

async function runConsumer() {
  console.log(`Connecting Kafka consumer to broker ${BROKER} with groupId ${GROUP_ID}...`);
  await consumer.connect();

  // subscribe (use FROM_BEGINNING env to control whether to replay)
  await consumer.subscribe({ topic: RSI_TOPIC, fromBeginning: FROM_BEGINNING });
  console.log(`Kafka consumer subscribed to topic ${RSI_TOPIC} (fromBeginning=${FROM_BEGINNING})`);

  await consumer.run({
    eachMessage: async ({ topic, partition, message }) => {
      try {
        const raw = message.value && message.value.toString();
        if (!raw) return;

        // optional debug log
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
          parsed.key ||
          'unknown';

        // parse numeric fields
        const rsi = typeof parsed.rsi === 'number' ? parsed.rsi : parseFloat(parsed.rsi);
        let price;
        if (typeof parsed.price === 'number') price = parsed.price;
        else if (parsed.price_in_sol) price = parseFloat(parsed.price_in_sol);
        else if (parsed.price) price = parseFloat(parsed.price);
        else if (parsed.priceInSol) price = parseFloat(parsed.priceInSol);

        const timestamp_ms = parsed.timestamp_ms || Date.now();

        // store latest (guard basic types)
        latest[token] = {
          rsi: Number.isFinite(rsi) ? rsi : null,
          price: Number.isFinite(price) ? price : null,
          timestamp_ms,
        };

        // prepare payload and broadcast as explicit update
        const payload = { token, ...latest[token] };
        broadcastSse({ type: 'update', payload });
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
    server.close(() => console.log('HTTP server closed.'));
    for (const res of clients) {
      try { res.end(); } catch (e) {}
    }
    clients.clear();

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

process.on('unhandledRejection', (err) => {
  console.error('UnhandledRejection:', err);
});
