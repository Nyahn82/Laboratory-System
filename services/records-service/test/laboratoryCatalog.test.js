import { describe, expect, it } from 'vitest';
import { createInitialState } from '../src/repositories/seedData.js';
import { ensureLaboratoryCatalog } from '../src/repositories/laboratoryCatalog.js';
describe('laboratory catalog', () => {
  it('provides the requested tests and panel definitions', () => {
    const state=createInitialState();
    expect(state.testPanels.map(panel=>panel.panelCode)).toEqual(expect.arrayContaining(['CBC','LIPID']));
    expect(state.testCatalog.map(test=>test.testCode)).toEqual(expect.arrayContaining(['FBS','RBS','HBA1C','BLOOD_TYPING','CREATININE']));
    expect(state.panelTests.filter(link=>link.panelId==='panel-lipid')).toHaveLength(4);
  });
  it('upgrades older catalogs once without changing existing ranges or orders', () => {
    const state=createInitialState();
    state.testCatalog=state.testCatalog.filter(test=>!['FBS','RBS'].includes(test.testCode));
    state.testPanels=state.testPanels.filter(panel=>panel.panelCode!=='LIPID');
    state.panelTests=state.panelTests.filter(link=>link.panelId!=='panel-lipid');
    const ranges=structuredClone(state.referenceRanges);
    state.labOrders.push({orderId:'existing-order'});
    expect(ensureLaboratoryCatalog(state)).toBeGreaterThan(0);
    expect(ensureLaboratoryCatalog(state)).toBe(0);
    expect(state.referenceRanges).toEqual(ranges);
    expect(state.labOrders).toEqual([{orderId:'existing-order'}]);
  });
});
