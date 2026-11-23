import EmbeddedPostgres from 'embedded-postgres';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

const secretFile = join(process.cwd(), 'postgres.secret');
if (!existsSync(secretFile)) writeFileSync(secretFile, randomBytes(24).toString('hex'));
const password = readFileSync(secretFile, 'utf8');
const databaseDir = join(process.env.LOCALAPPDATA, 'CantonPrivatePoc', 'postgres');
const db = new EmbeddedPostgres({
  databaseDir,
  user: 'poc',
  password,
  port: 15432,
  persistent: true,
  initdbFlags: ['--locale=C', '--encoding=UTF8', '--auth=scram-sha-256'],
  postgresFlags: ['-c', 'listen_addresses=127.0.0.1']
});
if (!existsSync(join(databaseDir, 'PG_VERSION'))) await db.initialise();
await db.start();
const client = db.getPgClient();
await client.connect();
try {
  for (const name of ['pqs_issuer', 'pqs_broker', 'poc_workflow']) {
    const result = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (result.rowCount === 0) await client.query('CREATE DATABASE ' + name);
  }
} finally {
  await client.end();
}
console.log('PostgreSQL ready on 127.0.0.1:15432');
process.on('SIGINT', async () => { await db.stop(); process.exit(0); });
