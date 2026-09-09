import { readFile } from 'node:fs/promises';
import mysql from 'mysql2/promise';
import { loadConfig } from '../config.js';

const config = loadConfig();
if (config.dbDriver !== 'mysql') {
  console.log('Verification metadata uses the atomic JSON adapter; no SQL migration is required.');
  process.exit(0);
}
const sql = await readFile(new URL('./migrations/001_verification.sql', import.meta.url), 'utf8');
const connection = await mysql.createConnection({ ...config.mysql, multipleStatements: true, timezone: 'Z' });
try {
  await connection.query(sql);
  console.log('Verification database migration completed.');
} finally {
  await connection.end();
}
