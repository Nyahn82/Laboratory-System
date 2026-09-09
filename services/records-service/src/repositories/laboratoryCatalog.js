const createdAt = '2026-09-09T00:00:00.000Z';
const additionalTests = [
  ['FBS', 'Fasting Blood Sugar'], ['RBS', 'Random Blood Sugar'], ['HBA1C', 'HbA1c'],
  ['BLOOD_TYPING', 'Blood Typing'], ['CREATININE', 'Creatinine'],
  ['CHOL', 'Total Cholesterol'], ['HDL', 'HDL Cholesterol'],
  ['LDL', 'LDL Cholesterol'], ['TRIG', 'Triglycerides'],
];

// Add missing catalog entries without replacing existing records or configured ranges.
export function ensureLaboratoryCatalog(state) {
  let added = 0;
  for (const [testCode, testName] of additionalTests) {
    if (state.testCatalog.some(test => test.testCode.toUpperCase() === testCode)) continue;
    state.testCatalog.push({ testId: `test-${testCode.toLowerCase()}`, testCode, testName, defaultUnit: '', sampleTypeId: 'sample-blood', methodology: null, sortOrder: 100 + added, isActive: true, createdAt });
    added += 1;
  }
  let lipid = state.testPanels.find(panel => panel.panelCode.toUpperCase() === 'LIPID');
  if (!lipid) {
    lipid = { panelId: 'panel-lipid', panelCode: 'LIPID', panelName: 'Lipid Profile', department: 'Chemistry', description: 'Lipid profile', isActive: true };
    state.testPanels.push(lipid);
    added += 1;
  }
  ['CHOL', 'HDL', 'LDL', 'TRIG'].forEach((code, index) => {
    const test = state.testCatalog.find(item => item.testCode.toUpperCase() === code);
    if (state.panelTests.some(link => link.panelId === lipid.panelId && link.testId === test.testId)) return;
    state.panelTests.push({ panelTestId: `${lipid.panelId}-${test.testId}`, panelId: lipid.panelId, testId: test.testId, sortOrder: index + 1, isRequired: true });
    added += 1;
  });
  return added;
}
