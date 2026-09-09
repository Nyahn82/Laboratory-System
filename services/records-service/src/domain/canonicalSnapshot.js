function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortObject(value[key])]));
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(sortObject(value));
}

export function buildCanonicalResultSnapshot(state, versionId) {
  const version = state.resultVersions.find((item) => item.resultVersionId === versionId);
  if (!version) return null;
  const order = state.labOrders.find((item) => item.orderId === version.orderId);
  const patient = state.patients.find((item) => item.patientId === order?.patientId);
  const items = state.resultItems
    .filter((item) => item.resultVersionId === versionId)
    .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
    .map(({ resultItemId, testId, testNameSnapshot, resultValue, numericValue, unitSnapshot, referenceRangeSnapshot, flag, remarks, sortOrder }) => ({
      resultItemId,
      testId,
      testNameSnapshot,
      resultValue,
      numericValue,
      unitSnapshot,
      referenceRangeSnapshot,
      flag,
      remarks,
      sortOrder,
    }));
  return sortObject({
    schema: 'rhu.lab-result.v1',
    opaqueRecordId: order?.opaqueRecordId,
    version: version.versionNumber,
    reportCode: version.reportCode,
    orderCode: order?.orderCode,
    patientSnapshot: version.patientSnapshot || {
      patientCode: patient?.patientCode,
      firstName: patient?.firstName,
      middleName: patient?.middleName,
      lastName: patient?.lastName,
      suffix: patient?.suffix,
      birthDate: patient?.birthDate,
      sex: patient?.sex,
    },
    submittedAt: version.submittedAt,
    verifiedAt: version.verifiedAt,
    items,
  });
}
