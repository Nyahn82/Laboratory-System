import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { loadConfig } from '../config.js';
import { FileRecordsRepository } from '../repositories/fileRecordsRepository.js';
import { createInitialState } from '../repositories/seedData.js';

export async function seed(config = loadConfig()) {
  const state = createInitialState();
  if (config.dbDriver === 'file') {
    const repository = new FileRecordsRepository({ filePath: config.recordsDataFile });
    await repository.initialize();
    await repository.replace(state);
    console.log(`Seeded synthetic records data at ${config.recordsDataFile}`);
    return;
  }
  const pool = mysql.createPool({ ...config.database, timezone: 'Z' });
  try {
    await pool.execute('INSERT INTO records_service_state (state_id, state_json, revision) VALUES (1, ?, 0) ON DUPLICATE KEY UPDATE state_json = VALUES(state_json), revision = 0', [JSON.stringify(state)]);
    for (const facility of state.facilities) await pool.execute('INSERT INTO facility_profile (facility_id, facility_name, facility_type, address, email, created_at) VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE facility_name = VALUES(facility_name)', [facility.facilityId, facility.facilityName, facility.facilityType, facility.address, facility.email, facility.createdAt.slice(0, 23).replace('T', ' ')]);
    for (const sample of state.sampleTypes) await pool.execute('INSERT INTO sample_type (sample_type_id, sample_name, description, is_active) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE sample_name = VALUES(sample_name)', [sample.sampleTypeId, sample.sampleName, sample.description, sample.isActive]);
    for (const panel of state.testPanels) await pool.execute('INSERT INTO test_panel (panel_id, panel_code, panel_name, department, description, is_active) VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE panel_name = VALUES(panel_name)', [panel.panelId, panel.panelCode, panel.panelName, panel.department, panel.description, panel.isActive]);
    for (const test of state.testCatalog) await pool.execute('INSERT INTO test_catalog (test_id, test_code, test_name, default_unit, sample_type_id, methodology, sort_order, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE test_name = VALUES(test_name), default_unit = VALUES(default_unit)', [test.testId, test.testCode, test.testName, test.defaultUnit, test.sampleTypeId, test.methodology, test.sortOrder, test.isActive]);
    for (const link of state.panelTests) await pool.execute('INSERT INTO panel_test (panel_test_id, panel_id, test_id, sort_order, is_required) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE sort_order = VALUES(sort_order), is_required = VALUES(is_required)', [link.panelTestId, link.panelId, link.testId, link.sortOrder, link.isRequired]);
    for (const range of state.referenceRanges) await pool.execute('INSERT INTO reference_range (range_id, test_id, sex, age_min, age_max, age_unit, normal_low, normal_high, unit, critical_low, critical_high, interpretation_note, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE normal_low = VALUES(normal_low), normal_high = VALUES(normal_high), critical_low = VALUES(critical_low), critical_high = VALUES(critical_high)', [range.rangeId, range.testId, range.sex, range.ageMin, range.ageMax, range.ageUnit, range.normalLow, range.normalHigh, range.unit, range.criticalLow, range.criticalHigh, range.interpretationNote, range.isActive]);
    console.log('Seeded synthetic CBC catalog and state document.');
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  seed().catch((error) => { console.error(error); process.exitCode = 1; });
}
