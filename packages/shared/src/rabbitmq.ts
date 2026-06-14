import * as amqp from 'amqplib';

const EXCHANGE = 'wickets.events';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let connection: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let channel: any = null;

export async function getRabbitChannel() {
  if (channel) return channel;
  const url = process.env.RABBITMQ_URL ?? 'amqp://localhost';
  connection = await amqp.connect(url);
  channel = await connection.createChannel();
  await channel.assertExchange(EXCHANGE, 'topic', { durable: true });
  return channel;
}

export async function publishEvent(routingKey: string, payload: object) {
  const ch = await getRabbitChannel();
  ch.publish(EXCHANGE, routingKey, Buffer.from(JSON.stringify(payload)), {
    persistent: true,
    contentType: 'application/json',
  });
}

export async function subscribeEvent(
  routingKey: string,
  queueName: string,
  handler: (payload: unknown) => Promise<void>,
) {
  const ch = await getRabbitChannel();
  await ch.assertQueue(queueName, { durable: true });
  await ch.bindQueue(queueName, EXCHANGE, routingKey);
  ch.consume(queueName, async (msg: amqp.ConsumeMessage | null) => {
    if (!msg) return;
    try {
      const payload = JSON.parse(msg.content.toString());
      await handler(payload);
      ch.ack(msg);
    } catch {
      ch.nack(msg, false, false);
    }
  });
}
