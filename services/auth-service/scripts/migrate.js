import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { loadConfig } from '../src/config.js';
import { FileAuthStore } from '../src/stores/file-auth-store.js';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const migrationsDirectory = path.resolve(currentDirectory, '../migrations');
const config = loadConfig();

if (config.dbDriver === 'file') {
  const store = new FileAuthStore({ filename: config.authDataFile });
  await store.healthCheck();
  await store.close();
  console.log(`authentication data file ready: ${config.authDataFile} (simulated atomic-json adapter)`);
} else {
  const connection = await mysql.createConnection({
    ...config.database,
    multipleStatements: true,
    timezone: 'Z',
    charset: 'utf8mb4',
  });

  try {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename VARCHAR(255) NOT NULL PRIMARY KEY,
        applied_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);

    const filenames = (await fs.readdir(migrationsDirectory))
      .filter((filename) => /^\d+_.+\.sql$/.test(filename))
      .sort();
    const [appliedRows] = await connection.query('SELECT filename FROM schema_migrations');
    const applied = new Set(appliedRows.map((row) => row.filename));

    for (const filename of filenames) {
      if (applied.has(filename)) {
        console.log(`skip ${filename}`);
        continue;
      }
      const sql = await fs.readFile(path.join(migrationsDirectory, filename), 'utf8');
      console.log(`apply ${filename}`);
      await connection.query(sql);
      await connection.execute('INSERT INTO schema_migrations (filename) VALUES (?)', [filename]);
    }
    console.log('migrations complete');
  } finally {
    await connection.end();
  }
}
