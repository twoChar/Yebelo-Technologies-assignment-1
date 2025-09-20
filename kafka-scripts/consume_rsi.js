const { Kafka } = require('kafkajs');

(async () => {
  const kafka = new Kafka({
    clientId: 'peek-rsi',
    brokers: [process.env.KAFKA_BROKER || 'localhost:29092'],
  });

  const consumer = kafka.consumer({ groupId: 'peek-rsi-' + Date.now() });
  await consumer.connect();
  await consumer.subscribe({ topic: process.env.TOPIC || 'rsi-data', fromBeginning: true });

  console.log('Connected. Waiting for messages on', process.env.TOPIC || 'rsi-data');
  await consumer.run({
    eachMessage: async ({ topic, partition, message }) => {
      console.log('RSI:', message.value.toString());
    },
  });
})();
