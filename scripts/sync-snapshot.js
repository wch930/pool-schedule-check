import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPoolsPayload } from '../lib/toronto-api.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, '..', 'public', 'data');
const outFile = path.join(outDir, 'pools.json');

const payload = await getPoolsPayload({ forceRefresh: true });
await fs.mkdir(outDir, { recursive: true });
await fs.writeFile(outFile, JSON.stringify(payload, null, 2), 'utf-8');
console.log(`Saved snapshot (${payload.pools.length} pools) to ${outFile}`);
