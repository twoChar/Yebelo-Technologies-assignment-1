// server.js
const express = require('express');
const cors = require('cors');
const { Kafka } = require('kafkajs');

const PORT = process.env.PORT || 4000;
const BROKER = process.env.KAFKA_BROKER || 'localhost:29092';
const RSI_TOPIC = process.env.RSI_TOPIC || 'rsi-data';

const kafka = new Kafka({ clientId: 'rsi-broadcaster', brokers: [BROKER] });
const consumer = kafka.consumer({ groupId: 'rsi-broadcaster-group' });

const app = express();
app.use(cors());
app.use(express.json());

// In-memory latest snapshot: { tokenAddress -> { rsi, price, timestamp_ms } }
const latest = {};

// SSE clients
const sseClients = new Set();

app.get('/api/latest-rsi', (req, res) => {
  // return the snapshot as an array for easier consumption
  const snapshot = Object.entries(latest).map(([token, payload]) => ({ token, ...payload }));
  res.json({ snapshot });
});

app.get('/events', (req, res) => {
  // Set headers for SSE
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write('\n');

  sseClients.add(res);

  req.on('close', () => {
    sseClients.delete(res);
  });
});

function broadcastEvent(obj) {
  const payload = `data: ${JSON.stringify(obj)}\n\n`;
  for (const client of sseClients) {
    try { client.write(payload); } catch (e) { /* ignore */ }
  }
}

async function runConsumer() {
  await consumer.connect();
  await consumer.subscribe({ topic: RSI_TOPIC, fromBeginning: false });
  console.log(`Kafka consumer connected to ${BROKER}, subscribed to ${RSI_TOPIC}`);

  await consumer.run({
    eachMessage: async ({ message }) => {
      try {
        const str = message.value.toString();
        const parsed = JSON.parse(str);
        const token = parsed.token_address || parsed.token || 'unknown';
        // store latest
        latest[token] = {
          rsi: parsed.rsi,
          price: parsed.price,
          timestamp_ms: parsed.timestamp_ms || Date.now()
        };
        // broadcast via SSE
        broadcastEvent({ token, ...latest[token] });
      } catch (err) {
        console.error('Failed to parse message', err);
      }
    }
  });
}

app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
  runConsumer().catch(err => {
    console.error('Kafka consumer failed', err);
    process.exit(1);
  });
});
