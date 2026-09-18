import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { createServer } from './app';
const port = Number(process.env.RELAY_API_PORT || 4317);
const dataDir = process.env.RELAY_API_DATA || path.resolve('data');
const secret = process.env.RELAY_API_SECRET;
if (!secret || secret.length < 32)
  throw new Error('Set RELAY_API_SECRET to a random value of at least 32 characters.');
await mkdir(dataDir, { recursive: true });
const app = await createServer({
  dbPath: path.join(dataDir, 'relay-api.sqlite'),
  jwtSecret: secret,
  corsOrigin: process.env.RELAY_API_ORIGIN,
});
await app.listen({ port, host: process.env.RELAY_API_HOST || '127.0.0.1' });
console.log(`Relay Studio API listening on http://127.0.0.1:${port}`);
