import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { loadConfig } from '../config.js';
import { FileRecordsRepository } from '../repositories/fileRecordsRepository.js';

export async function migrate(config = loadConfig()) {
  if (config.dbDriver !== 'mysql') {
    const repository = new FileRecordsRepository({ filePath: config.recordsDataFile });
    await repository.initialize();
    await repository.close();
    console.log(`Records data file ready: ${config.recordsDataFile} (simulated atomic-json adapter)`);
    return;
  }
  const pool = mysql.createPool({ ...config.database, multipleStatements: true, timezone: 'Z' });
  const directory = fileURLToPath(new URL('../../migrations', import.meta.url));
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      migration_name VARCHAR(255) PRIMARY KEY,
      applied_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
    ) ENGINE=InnoDB`);
    const [appliedRows] = await pool.query('SELECT migration_name FROM schema_migrations');
    const applied = new Set(appliedRows.map((row) => row.migration_name));
    const files = (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort();
    for (const file of files) {
      if (applied.has(file)) continue;
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        await connection.query(await readFile(path.join(directory, file), 'utf8'));
        await connection.execute('INSERT INTO schema_migrations (migration_name) VALUES (?)', [file]);
        await connection.commit();
        console.log(`Applied ${file}`);
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    }
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  migrate().catch((error) => { console.error(error); process.exitCode = 1; });
}
