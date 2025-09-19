// ingest.js (stable: batch send + disconnect instead of flush)
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const { Kafka, Partitioners } = require('kafkajs');

const BROKER = process.env.KAFKA_BROKER || 'localhost:29092';
const TOPIC = process.env.TOPIC || 'trade-data';
const CSV_FILE = process.env.CSV_FILE || path.join(__dirname, 'trades_data.csv');

const kafka = new Kafka({
  clientId: 'trade-data-producer',
  brokers: [BROKER],
});

const producer = kafka.producer({
  allowAutoTopicCreation: true,
  createPartitioner: Partitioners.LegacyPartitioner,
});

async function readCsvToArray(file) {
  return new Promise((resolve, reject) => {
    const rows = [];
    fs.createReadStream(file)
      .pipe(csv())
      .on('data', (row) => rows.push(row))
      .on('end', () => resolve(rows))
      .on('error', (err) => reject(err));
  });
}

async function sendBatches(rows, batchSize = 100) {
  for (let i = 0; i < rows.length; i += batchSize) {
    const slice = rows.slice(i, i + batchSize);
    const messages = slice.map((r) => ({ value: JSON.stringify(r) }));
    await producer.send({ topic: TOPIC, messages, timeout: 30000 });
    console.log(`Sent batch ${Math.floor(i / batchSize) + 1} (${messages.length} messages)`);
  }
}

(async () => {
  try {
    console.log(`Connecting to broker ${BROKER}...`);
    await producer.connect();
    console.log('Connected. Reading CSV...');
    const rows = await readCsvToArray(CSV_FILE);
    console.log(`Read ${rows.length} rows. Sending to topic "${TOPIC}" in batches...`);

    await sendBatches(rows, 100);

    console.log('All messages sent. Disconnecting producer...');
    await producer.disconnect();
    console.log('Done.');
    process.exit(0);
  } catch (err) {
    console.error('Fatal error in ingestion:', err);
    try { await producer.disconnect(); } catch (_) {}
    process.exit(1);
  }
})();
