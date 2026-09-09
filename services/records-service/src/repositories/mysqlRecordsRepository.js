import mysql from 'mysql2/promise';
import { createInitialState } from './seedData.js';

export class MysqlRecordsRepository {
  constructor(database) {
    this.pool = mysql.createPool({
      host: database.host,
      port: database.port,
      user: database.user,
      password: database.password,
      database: database.database,
      connectionLimit: database.connectionLimit,
      timezone: 'Z',
      decimalNumbers: true,
    });
  }

  async initialize() {
    await this.pool.execute(`
      CREATE TABLE IF NOT EXISTS records_service_state (
        state_id TINYINT PRIMARY KEY,
        state_json JSON NOT NULL,
        revision BIGINT NOT NULL DEFAULT 0,
        updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)
      ) ENGINE=InnoDB
    `);
    await this.pool.execute(
      'INSERT IGNORE INTO records_service_state (state_id, state_json, revision) VALUES (1, ?, 0)',
      [JSON.stringify(createInitialState())],
    );
  }

  async snapshot() {
    await this.initialize();
    const [rows] = await this.pool.execute('SELECT state_json FROM records_service_state WHERE state_id = 1');
    const value = rows[0]?.state_json;
    return structuredClone(typeof value === 'string' ? JSON.parse(value) : value);
  }

  async transact(mutator) {
    await this.initialize();
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.query('SELECT state_json, revision FROM records_service_state WHERE state_id = 1 FOR UPDATE');
      const raw = rows[0].state_json;
      const draft = typeof raw === 'string' ? JSON.parse(raw) : structuredClone(raw);
      const result = await mutator(draft);
      draft.revision = Number(rows[0].revision || 0) + 1;
      await connection.execute('UPDATE records_service_state SET state_json = ?, revision = ? WHERE state_id = 1', [JSON.stringify(draft), draft.revision]);
      await connection.commit();
      return structuredClone(result);
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async replace(state) {
    return this.transact((draft) => {
      for (const key of Object.keys(draft)) delete draft[key];
      Object.assign(draft, structuredClone(state));
      return { revision: draft.revision };
    });
  }

  async ping() {
    const [rows] = await this.pool.query('SELECT 1 AS ok');
    return { ok: rows[0].ok === 1, driver: 'mysql', simulated: false };
  }

  async close() {
    await this.pool.end();
  }
}
