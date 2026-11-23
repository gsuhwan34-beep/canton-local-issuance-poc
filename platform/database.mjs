import pg from 'pg';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function database(name) {
  const secret = join(process.env.LOCALAPPDATA, 'CantonPrivatePoc', 'runtime', 'postgres.secret');
  return new pg.Pool({
    host: '127.0.0.1', port: 15432, user: 'poc', database: name,
    password: (await readFile(secret, 'utf8')).trim(), max: 3, connectionTimeoutMillis: 5000
  });
}
