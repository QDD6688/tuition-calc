import { Redis } from '@upstash/redis';

let client;

export function getRedis() {
  if (client !== undefined) return client;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    client = null;
    return client;
  }

  client = new Redis({ url, token, enableTelemetry: false });
  return client;
}
