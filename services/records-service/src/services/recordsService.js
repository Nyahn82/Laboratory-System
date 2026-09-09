import { ensureLaboratoryCatalog } from '../repositories/laboratoryCatalog.js';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { ApiError, assertCondition, assertFound } from '../errors.js';
import {
  ORDER_DISPLAY_STATUS,
  ORDER_STATUS,
  PUBLICATION_STATUS,
  RESULT_DISPLAY_STATUS,
  RESULT_VERSION_STATUS,
} from '../domain/statuses.js';
import { buildCanonicalResultSnapshot, canonicalJson } from '../domain/canonicalSnapshot.js';
import { decorateOrder, decorateResultVersion, transitionOrder } from '../domain/workflow.js';

const now = () => new Date().toISOString();
const id = () => randomUUID();
const hash = (value) => createHash('sha256').update(typeof value === 'string' ? value : canonicalJson(value)).digest('hex');
const hasRole = (user, role) => user.roles.includes(role);
const nullable = (value) => value ?? null;

// Keep the display address compatible with existing reports and patient records.
function patientAddress(input) {
  if (Object.hasOwn(input, 'addressDetails')) {
    const fields = ['houseNumber', 'street', 'barangay', 'municipality', 'province', 'region', 'postalCode', 'country'];
    const details = Object.fromEntries(fields.map((field) => [field, input.addressDetails?.[field]?.trim() || null]));
    const address = [
      [details.houseNumber, details.street].filter(Boolean).join(' '),
      details.barangay, details.municipality, details.province, details.region, details.postalCode, details.country,
    ].filter(Boolean).join(', ');
    return { address: address || null, addressDetails: address ? details : null };
  }
  if (Object.hasOwn(input, 'address')) return { address: input.address?.trim() || null, addressDetails: null };
  return {};
}

function nextCode(prefix, records, field, width = 6) {
  const year = new Date().getUTCFullYear();
  const sequence = records.length + 1;
  let candidate = `${prefix}-${year}-${String(sequence).padStart(width, '0')}`;
  let increment = sequence;
  while (records.some((record) => record[field] === candidate)) {
    increment += 1;
    candidate = `${prefix}-${year}-${String(increment).padStart(width, '0')}`;
  }
  return candidate;
}

function audit(state, user, context, action, entityType, entityId, metadata = {}) {
  const latestTransition = [...state.statusHistory].reverse().find((entry) => entry.entityId === entityId);
  state.audits.push({
    auditId: id(),
    actorUserId: user.id,
    actorRoles: [...user.roles],
    actorRole: user.roles[0] || null,
    action,
    entityType,
    entityId,
    metadata,
    previousStatus: metadata.previousStatus ?? latestTransition?.fromStatus ?? null,
    newStatus: metadata.newStatus ?? latestTransition?.toStatus ?? null,
    deviceOrSource: context?.deviceId || context?.source || context?.ipAddress || null,
    reasonOrRemarks: metadata.reason || metadata.remarks || null,
    requestId: context?.requestId || null,
    ipAddress: context?.ipAddress || null,
    createdAt: now(),
  });
}

function statusHistory(state, entityType, entityId, fromStatus, toStatus, user, reason = null) {
  state.statusHistory.push({
    historyId: id(),
    entityType,
    entityId,
    fromStatus,
    toStatus,
    displayStatus: entityType === 'RESULT_VERSION' ? RESULT_DISPLAY_STATUS[toStatus] || toStatus : null,
    reason,
    actorUserId: user.id,
    createdAt: now(),
  });
}

function setVersionStatus(state, version, toStatus, user, reason = null) {
  const fromStatus = version.status;
  version.status = toStatus;
  version.displayStatus = RESULT_DISPLAY_STATUS[toStatus] || toStatus;
  version.updatedAt = now();
  version.revision = (version.revision || 0) + 1;
  statusHistory(state, 'RESULT_VERSION', version.resultVersionId, fromStatus, toStatus, user, reason);
}

function ageInYears(birthDate, atDate) {
  if (!birthDate) return null;
  const birth = new Date(`${birthDate}T00:00:00.000Z`);
  const at = new Date(atDate);
  if (Number.isNaN(birth.valueOf()) || Number.isNaN(at.valueOf())) return null;
  return (at.valueOf() - birth.valueOf()) / (365.2425 * 24 * 60 * 60 * 1000);
}

function printableRange(range) {
  if (!range) return null;
  if (range.normalLow != null && range.normalHigh != null) return `${range.normalLow} - ${range.normalHigh}`;
  if (range.normalLow != null) return `>= ${range.normalLow}`;
  if (range.normalHigh != null) return `<= ${range.normalHigh}`;
  return null;
}

function deriveFlag(numericValue, range) {
  if (numericValue == null || !range) return null;
  if (range.criticalLow != null && numericValue < range.criticalLow) return 'Critical Low';
  if (range.criticalHigh != null && numericValue > range.criticalHigh) return 'Critical High';
  if (range.normalLow != null && numericValue < range.normalLow) return 'Low';
  if (range.normalHigh != null && numericValue > range.normalHigh) return 'High';
  return 'Normal';
}

function findReferenceRange(state, test, patient, order, unit) {
  const age = ageInYears(patient?.birthDate, order.orderDate);
  const candidates = state.referenceRanges.filter((range) => {
    if (!range.isActive || range.testId !== test.testId) return false;
    if (range.sex !== 'Any' && range.sex !== patient?.sex) return false;
    if (age != null && range.ageMin != null && age < range.ageMin) return false;
    if (age != null && range.ageMax != null && age > range.ageMax) return false;
    if (range.unit && unit && range.unit !== unit) return false;
    return true;
  });
  return candidates.sort((a, b) => {
    const sexScore = (value) => value.sex === patient?.sex ? 0 : 1;
    return sexScore(a) - sexScore(b) || ((a.ageMax ?? 9999) - (a.ageMin ?? 0)) - ((b.ageMax ?? 9999) - (b.ageMin ?? 0));
  })[0] || null;
}

function versionPatientSnapshot(patient, order) {
  return {
    patientCode: patient.patientCode,
    firstName: patient.firstName,
    middleName: patient.middleName,
    lastName: patient.lastName,
    suffix: patient.suffix,
    birthDate: patient.birthDate,
    ageSnapshot: ageInYears(patient.birthDate, order.orderDate) == null ? null : Math.floor(ageInYears(patient.birthDate, order.orderDate)),
    sex: patient.sex,
    address: patient.address,
  };
}

function makeReferenceSnapshot(range) {
  if (!range) return null;
  return {
    rangeId: range.rangeId,
    sex: range.sex,
    ageMin: range.ageMin,
    ageMax: range.ageMax,
    ageUnit: range.ageUnit || 'years',
    normalLow: range.normalLow,
    normalHigh: range.normalHigh,
    criticalLow: range.criticalLow,
    criticalHigh: range.criticalHigh,
    unit: range.unit,
    printable: printableRange(range),
    interpretationNote: range.interpretationNote || null,
  };
}

function asList(items, query) {
  let filtered = items;
  if (query.status) filtered = filtered.filter((item) => item.status === query.status || item.displayStatus === query.status);
  if (query.q) {
    const term = query.q.toLowerCase();
    filtered = filtered.filter((item) => JSON.stringify(item).toLowerCase().includes(term));
  }
  if (query.sort) {
    const direction = query.direction === 'asc' ? 1 : -1;
    filtered = [...filtered].sort((left, right) => String(left[query.sort] ?? '').localeCompare(String(right[query.sort] ?? '')) * direction);
  }
  const total = filtered.length;
  const limit = query.limit || 50;
  const offset = query.offset || 0;
  return { items: filtered.slice(offset, offset + limit), total, limit, offset, page: query.page || Math.floor(offset / limit) + 1, pageSize: limit };
}

export class RecordsService {
  constructor({ repository, publicationClients, config }) {
    this.repository = repository;
    this.publicationClients = publicationClients;
    this.config = config;
  }

  async initialize() {
    await this.repository.initialize();
    if (ensureLaboratoryCatalog(await this.repository.snapshot())) {
      await this.repository.transact(state => ensureLaboratoryCatalog(state));
    }
  }

  async command({ key, user, scope, input }, operation) {
    const requestHash = hash({ scope, input });
    const reservation = await this.repository.transact((state) => {
      const existing = state.idempotencyRecords.find((item) => item.key === key && item.actorUserId === user.id && item.scope === scope);
      if (existing) {
        if (existing.requestHash !== requestHash) throw new ApiError(409, 'The idempotency key was already used with a different request.', 'IDEMPOTENCY_CONFLICT');
        if (existing.status === 'COMPLETED') return { replay: true, response: existing.response };
        throw new ApiError(409, 'An operation with this idempotency key is already in progress.', 'IDEMPOTENCY_IN_PROGRESS');
      }
      state.idempotencyRecords.push({ idempotencyId: id(), key, actorUserId: user.id, scope, requestHash, status: 'IN_PROGRESS', response: null, createdAt: now(), completedAt: null });
      return { replay: false };
    });
    if (reservation.replay) return { ...reservation.response, replayed: true };

    try {
      const response = await operation();
      await this.repository.transact((state) => {
        const record = state.idempotencyRecords.find((item) => item.key === key && item.actorUserId === user.id && item.scope === scope);
        record.status = 'COMPLETED';
        record.response = response;
        record.completedAt = now();
        return null;
      });
      return { ...response, replayed: false };
    } catch (error) {
      await this.repository.transact((state) => {
        const index = state.idempotencyRecords.findIndex((item) => item.key === key && item.actorUserId === user.id && item.scope === scope && item.status === 'IN_PROGRESS');
        if (index >= 0) state.idempotencyRecords.splice(index, 1);
        return null;
      }).catch(() => {});
      throw error;
    }
  }

  async dashboard(user) {
    const state = await this.repository.snapshot();
    if (hasRole(user, 'PATIENT')) {
      const patientIds = this.#patientIdsForUser(state, user);
      const released = state.resultVersions.filter((version) => version.status === RESULT_VERSION_STATUS.RELEASED && patientIds.includes(state.labOrders.find((order) => order.orderId === version.orderId)?.patientId));
      return { releasedResults: released.length, pendingResults: 0 };
    }
    const visibleOrders = state.labOrders.filter((order) => this.#canReadOrder(state, user, order));
    const today = now().slice(0, 10);
    const visibleOrderIds = new Set(visibleOrders.map((order) => order.orderId));
    const recentActivity = state.audits
      .filter((entry) => hasRole(user, 'SYSTEM_ADMIN') || hasRole(user, 'LAB_SUPERVISOR') || entry.actorUserId === user.id || visibleOrderIds.has(entry.entityId) || visibleOrderIds.has(entry.metadata?.orderId))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, 8)
      .map((entry) => ({
        id: entry.auditId,
        action: entry.action,
        recordType: entry.entityType,
        recordId: entry.entityId,
        summary: entry.newStatus ? `${entry.previousStatus || 'New'} to ${entry.newStatus}` : entry.entityType,
        createdAt: entry.createdAt,
      }));
    const metrics = {
      pendingRequests: visibleOrders.filter((order) => order.status === ORDER_STATUS.REQUESTED).length,
      awaitingCollection: visibleOrders.filter((order) => [ORDER_STATUS.REQUESTED, ORDER_STATUS.PAYMENT_CLASSIFIED, ORDER_STATUS.ACCESSIONED, ORDER_STATUS.RECOLLECTION_REQUIRED].includes(order.status)).length,
      testingInProgress: visibleOrders.filter((order) => [ORDER_STATUS.COLLECTED, ORDER_STATUS.IN_TESTING].includes(order.status)).length,
      awaitingApproval: visibleOrders.filter((order) => order.status === ORDER_STATUS.FOR_VERIFICATION).length,
      releasedToday: visibleOrders.filter((order) => order.status === ORDER_STATUS.RELEASED && order.updatedAt?.startsWith(today)).length,
      failedSyncJobs: state.outbox.filter((event) => event.status === 'FAILED_REVIEW').length,
    };
    return {
      metrics,
      ...metrics,
      patients: hasRole(user, 'REGISTRATION_CASHIER') ? state.patients.filter((patient) => patient.isActive !== false).length : undefined,
      orders: visibleOrders.length,
      byStatus: Object.fromEntries(Object.values(ORDER_STATUS).map((status) => [status, visibleOrders.filter((order) => order.status === status).length])),
      pendingVerification: visibleOrders.filter((order) => order.status === ORDER_STATUS.FOR_VERIFICATION).length,
      publicationRetries: state.outbox.filter((event) => ['PENDING', 'RETRY_WAIT', 'FAILED_REVIEW'].includes(event.status)).length,
      recentActivity,
    };
  }

  async listRequestPatients(user, query) {
    assertCondition(hasRole(user, 'DOCTOR'), 403, 'Doctor access required.', 'ROLE_FORBIDDEN');
    const state = await this.repository.snapshot();
    const patients = state.patients.filter(patient => patient.isActive !== false && (!query.patientId || patient.patientId === query.patientId));
    const rows = patients.map(patient => {
      // Use the latest encounter so a new visit cannot silently reuse an old consultation.
      const visit = state.visits.filter(item => item.patientId === patient.patientId).reverse()
        .sort((a, b) => String(b.visitDate).localeCompare(String(a.visitDate)) || String(b.createdAt).localeCompare(String(a.createdAt)))[0];
      const consultations = state.consultations.filter(item => item.patientId === patient.patientId && (!visit || item.visitId === visit.visitId));
      const consultation = consultations.find(item => item.doctorAuthUserId === user.id && item.status === 'COMPLETED');
      const waitingVisit = visit?.status === 'OPEN' && !consultations.length ? visit : null;
      return {
        patientId: patient.patientId, patientCode: patient.patientCode,
        patientName: [patient.firstName, patient.middleName, patient.lastName, patient.suffix].filter(Boolean).join(' '),
        birthDate: patient.birthDate, address: patient.address,
        consultationId: consultation?.consultationId || null, consultationDate: consultation?.signedAt || null,
        visitId: waitingVisit?.visitId || null, reasonForVisit: waitingVisit?.chiefComplaint || '',
      };
    }).sort((a, b) => a.patientName.localeCompare(b.patientName) || a.patientCode.localeCompare(b.patientCode));
    // Search demographics only; another patient's clinical details are never searched or returned.
    const term = query.q?.toLowerCase();
    const filtered = term ? rows.filter(row => [row.patientName, row.patientCode, row.birthDate, row.address].some(value => value?.toLowerCase().includes(term))) : rows;
    return asList(filtered, { ...query, q: undefined });
  }

  async listPatients(user, query) {
    const state = await this.repository.snapshot();
    let patients = state.patients.filter((patient) => patient.isActive !== false);
    if (hasRole(user, 'DOCTOR')) {
      const ids = new Set(state.consultations.filter((item) => item.doctorAuthUserId === user.id).map((item) => item.patientId));
      state.visits.filter(visit => visit.status === 'OPEN' && !state.consultations.some(consultation => consultation.visitId === visit.visitId)).forEach(visit => ids.add(visit.patientId));
      patients = patients.filter((patient) => ids.has(patient.patientId));
    } else if (hasRole(user, 'LAB_STAFF') || hasRole(user, 'LAB_SUPERVISOR')) {
      const ids = new Set(state.labOrders.map((item) => item.patientId));
      patients = patients.filter((patient) => ids.has(patient.patientId));
    } else if (!hasRole(user, 'REGISTRATION_CASHIER')) {
      throw new ApiError(403, 'Clinical patient access is not granted by this role.', 'ROLE_FORBIDDEN');
    }
    return asList(patients, query);
  }

  async getPatient(user, patientId) {
    const state = await this.repository.snapshot();
    const patient = assertFound(state.patients.find((item) => item.patientId === patientId && item.isActive !== false), 'Patient');
    this.#assertPatientReadable(state, user, patientId);
    return patient;
  }

  async createPatient(input, user, context) {
    return this.repository.transact((state) => {
      const patientCode = input.patientCode || nextCode('PT', state.patients, 'patientCode');
      assertCondition(!state.patients.some((item) => item.patientCode.toLowerCase() === patientCode.toLowerCase()), 409, 'Patient code already exists.', 'PATIENT_CODE_CONFLICT');
      const timestamp = now();
      const patient = {
        patientId: id(), patientCode,
        firstName: input.firstName, middleName: nullable(input.middleName), lastName: input.lastName, suffix: nullable(input.suffix),
        birthDate: nullable(input.birthDate), ageSnapshot: null, sex: nullable(input.sex), civilStatus: nullable(input.civilStatus),
        nationality: nullable(input.nationality), contactNumber: nullable(input.contactNumber), email: nullable(input.email), address: null, addressDetails: null, ...patientAddress(input),
        isActive: true, revision: 1, createdAt: timestamp, updatedAt: null,
      };
      state.patients.push(patient);
      audit(state, user, context, 'PATIENT_CREATED', 'PATIENT', patient.patientId, { patientCode });
      if (input.reasonForVisit) {
        const visit = { visitId: id(), visitCode: nextCode('VIS', state.visits, 'visitCode'), patientId: patient.patientId, visitDate: timestamp, visitType: 'Outpatient', chiefComplaint: input.reasonForVisit.trim(), status: 'OPEN', revision: 1, createdBy: user.id, createdAt: timestamp, updatedAt: null };
        state.visits.push(visit);
        audit(state, user, context, 'VISIT_CREATED', 'VISIT', visit.visitId, { patientId: patient.patientId, source: 'REGISTRATION' });
        return { ...patient, visit };
      }
      return patient;
    });
  }

  async updatePatient(patientId, input, user, context) {
    return this.repository.transact((state) => {
      const patient = assertFound(state.patients.find((item) => item.patientId === patientId && item.isActive !== false), 'Patient');
      if (input.patientCode && state.patients.some((item) => item.patientId !== patientId && item.patientCode.toLowerCase() === input.patientCode.toLowerCase())) {
        throw new ApiError(409, 'Patient code already exists.', 'PATIENT_CODE_CONFLICT');
      }
      const changedFields = Object.keys(input);
      Object.assign(patient, input, patientAddress(input), { updatedAt: now(), revision: patient.revision + 1 });
      audit(state, user, context, 'PATIENT_UPDATED', 'PATIENT', patientId, { changedFields });
      return patient;
    });
  }

  async deactivatePatient(patientId, user, context) {
    return this.repository.transact((state) => {
      const patient = assertFound(state.patients.find((item) => item.patientId === patientId && item.isActive !== false), 'Patient');
      assertCondition(!state.labOrders.some((order) => order.patientId === patientId && ![ORDER_STATUS.RELEASED, ORDER_STATUS.CANCELLED].includes(order.status)), 409, 'Patient has an active laboratory workflow.', 'PATIENT_ACTIVE_WORKFLOW');
      patient.isActive = false;
      patient.deletedAt = now();
      patient.updatedAt = patient.deletedAt;
      patient.revision += 1;
      audit(state, user, context, 'PATIENT_DEACTIVATED', 'PATIENT', patientId);
      return patient;
    });
  }

  async linkPatientAccount(patientId, input, user, context) {
    return this.repository.transact((state) => {
      assertFound(state.patients.find((item) => item.patientId === patientId && item.isActive !== false), 'Patient');
      const existing = state.patientAccountLinks.find((item) => item.authUserId === input.authUserId || item.patientId === patientId);
      if (existing) {
        if (existing.authUserId === input.authUserId && existing.patientId === patientId) return existing;
        throw new ApiError(409, 'The patient or account is already linked.', 'PATIENT_ACCOUNT_LINK_CONFLICT');
      }
      const link = { linkId: id(), patientId, authUserId: input.authUserId, linkedBy: user.id, linkedAt: now() };
      state.patientAccountLinks.push(link);
      audit(state, user, context, 'PATIENT_ACCOUNT_LINKED', 'PATIENT', patientId, { authUserId: input.authUserId });
      return link;
    });
  }

  async listVisits(user, query) {
    const state = await this.repository.snapshot();
    let visits = state.visits;
    if (query.patientId) visits = visits.filter((visit) => visit.patientId === query.patientId);
    if (hasRole(user, 'DOCTOR')) {
      const ids = new Set(state.consultations.filter((item) => item.doctorAuthUserId === user.id).map((item) => item.visitId));
      visits = visits.filter((visit) => ids.has(visit.visitId) || visit.status === 'OPEN');
    } else if (!hasRole(user, 'REGISTRATION_CASHIER')) throw new ApiError(403, 'Visit access is not granted.', 'ROLE_FORBIDDEN');
    if (query.status === 'OPEN') visits = visits.filter(visit => !state.consultations.some(consultation => consultation.visitId === visit.visitId));
    visits = visits.filter(visit => state.patients.some(patient => patient.patientId === visit.patientId && patient.isActive !== false));
    return asList(visits.map(visit => {
      const patient = state.patients.find(item => item.patientId === visit.patientId);
      return { ...visit, reasonForVisit: visit.chiefComplaint, patientName: [patient.firstName, patient.middleName, patient.lastName].filter(Boolean).join(' '), patientCode: patient.patientCode };
    }), query);
  }

  async createVisit(input, user, context) {
    return this.repository.transact((state) => {
      assertFound(state.patients.find((item) => item.patientId === input.patientId && item.isActive !== false), 'Patient');
      const visit = { visitId: id(), visitCode: nextCode('VIS', state.visits, 'visitCode'), patientId: input.patientId, visitDate: input.visitDate || now(), visitType: input.visitType, chiefComplaint: nullable(input.chiefComplaint), status: 'OPEN', revision: 1, createdBy: user.id, createdAt: now(), updatedAt: null };
      state.visits.push(visit);
      audit(state, user, context, 'VISIT_CREATED', 'VISIT', visit.visitId, { patientId: input.patientId });
      return visit;
    });
  }

  async listConsultations(user, query) {
    const state = await this.repository.snapshot();
    let items = state.consultations;
    if (hasRole(user, 'DOCTOR')) items = items.filter((item) => item.doctorAuthUserId === user.id);
    else if (hasRole(user, 'REGISTRATION_CASHIER')) items = items.map(({ clinicalNotes, diagnosis, ...rest }) => rest);
    else if (!(hasRole(user, 'LAB_STAFF') || hasRole(user, 'LAB_SUPERVISOR'))) throw new ApiError(403, 'Consultation access is not granted.', 'ROLE_FORBIDDEN');
    if (query.patientId) items = items.filter((item) => item.patientId === query.patientId);
    return asList(items.map(item => {
      const visit = state.visits.find(visit => visit.visitId === item.visitId);
      const patient = state.patients.find(patient => patient.patientId === item.patientId);
      return { ...item, chiefComplaint: visit?.chiefComplaint, patientName: patient ? [patient.firstName, patient.middleName, patient.lastName].filter(Boolean).join(' ') : item.patientId };
    }), query);
  }

  async createConsultation(input, user, context) {
    return this.repository.transact((state) => {
      let visit = input.visitId ? state.visits.find((item) => item.visitId === input.visitId) : null;
      if (!visit && !input.visitId) {
        assertFound(state.patients.find((item) => item.patientId === input.patientId && item.isActive !== false), 'Patient');
        visit = {
          visitId: id(), visitCode: nextCode('VIS', state.visits, 'visitCode'), patientId: input.patientId,
          visitDate: now(), visitType: 'Outpatient', chiefComplaint: nullable(input.chiefComplaint), status: 'OPEN',
          revision: 1, createdBy: user.id, createdAt: now(), updatedAt: null,
        };
        state.visits.push(visit);
        audit(state, user, context, 'VISIT_CREATED', 'VISIT', visit.visitId, { patientId: input.patientId, source: 'DIRECT_CONSULTATION' });
      }
      assertFound(visit, 'Visit');
      assertCondition(visit.patientId === input.patientId, 409, 'Visit does not belong to the patient.', 'VISIT_PATIENT_MISMATCH');
      assertFound(state.patients.find(patient => patient.patientId === input.patientId && patient.isActive !== false), 'Patient');
      assertCondition(visit.status === 'OPEN' && !state.consultations.some(item => item.visitId === visit.visitId), 409, 'This visit already has a consultation or is closed.', 'VISIT_ALREADY_REVIEWED');
      const physician = state.requestingPhysicians.find((item) => item.authUserId === user.id || item.physicianId === user.physicianId);
      const timestamp = now();
      const consultation = {
        consultationId: id(), visitId: visit.visitId, patientId: input.patientId,
        physicianId: physician?.physicianId || user.physicianId || null, doctorAuthUserId: user.id,
        clinicalNotes: input.clinicalNotes, diagnosis: input.diagnosis || input.assessment,
        plan: nullable(input.plan), status: input.autoComplete ? 'COMPLETED' : 'DRAFT',
        signedAt: input.autoComplete ? timestamp : null, revision: 1, createdAt: timestamp, updatedAt: null,
      };
      state.consultations.push(consultation);
      if (input.autoComplete) { visit.status = 'CLOSED'; visit.updatedAt = timestamp; visit.revision += 1; }
      audit(state, user, context, 'CONSULTATION_CREATED', 'CONSULTATION', consultation.consultationId, { patientId: input.patientId });
      return consultation;
    });
  }

  async updateConsultation(consultationId, input, user, context) {
    return this.repository.transact((state) => {
      const consultation = assertFound(state.consultations.find((item) => item.consultationId === consultationId), 'Consultation');
      assertCondition(consultation.doctorAuthUserId === user.id, 403, 'Only the assigned doctor may update the consultation.', 'DOCTOR_ASSIGNMENT_REQUIRED');
      assertCondition(consultation.status === 'DRAFT', 409, 'Completed consultations are immutable.', 'CONSULTATION_IMMUTABLE');
      Object.assign(consultation, input, { revision: consultation.revision + 1, updatedAt: now() });
      audit(state, user, context, 'CONSULTATION_UPDATED', 'CONSULTATION', consultationId, { changedFields: Object.keys(input) });
      return consultation;
    });
  }

  async completeConsultation(consultationId, user, context) {
    return this.repository.transact((state) => {
      const consultation = assertFound(state.consultations.find((item) => item.consultationId === consultationId), 'Consultation');
      assertCondition(consultation.doctorAuthUserId === user.id, 403, 'Only the assigned doctor may complete the consultation.', 'DOCTOR_ASSIGNMENT_REQUIRED');
      assertCondition(consultation.status === 'DRAFT', 409, 'Consultation is already completed.', 'CONSULTATION_ALREADY_COMPLETED');
      consultation.status = 'COMPLETED'; consultation.signedAt = now(); consultation.updatedAt = consultation.signedAt; consultation.revision += 1;
      const visit = state.visits.find(item => item.visitId === consultation.visitId);
      if (visit) { visit.status = 'CLOSED'; visit.updatedAt = consultation.signedAt; visit.revision += 1; }
      audit(state, user, context, 'CONSULTATION_COMPLETED', 'CONSULTATION', consultationId);
      return consultation;
    });
  }

  async catalog() {
    const state = await this.repository.snapshot();
    return { sampleTypes: state.sampleTypes.filter((item) => item.isActive), panels: state.testPanels.filter((item) => item.isActive), tests: state.testCatalog.filter((item) => item.isActive), panelTests: state.panelTests, referenceRanges: state.referenceRanges.filter((item) => item.isActive) };
  }

  async createOrder(input, user, context) {
    return this.repository.transact((state) => {
      const consultation = assertFound(state.consultations.find((item) => item.consultationId === input.consultationId), 'Consultation');
      assertCondition(consultation.doctorAuthUserId === user.id, 403, 'Only the consulting doctor may create this order.', 'DOCTOR_ASSIGNMENT_REQUIRED');
      assertCondition(consultation.status === 'COMPLETED', 409, 'Consultation must be signed before ordering tests.', 'CONSULTATION_NOT_SIGNED');
      if (input.patientId) assertCondition(input.patientId === consultation.patientId, 409, 'Consultation does not belong to the requested patient.', 'CONSULTATION_PATIENT_MISMATCH');
      const patient = assertFound(state.patients.find((item) => item.patientId === consultation.patientId && item.isActive !== false), 'Patient');
      const panelIds = [...new Set(input.panelIds)];
      panelIds.forEach((panelId) => assertFound(state.testPanels.find((item) => item.panelId === panelId && item.isActive), 'Test panel'));
      const testIds = new Set(input.testIds);
      panelIds.forEach((panelId) => state.panelTests.filter((link) => link.panelId === panelId).forEach((link) => testIds.add(link.testId)));
      [...testIds].forEach((testId) => assertFound(state.testCatalog.find((item) => item.testId === testId && item.isActive), 'Catalog test'));
      const timestamp = now();
      const order = {
        orderId: id(), opaqueRecordId: id(), orderCode: nextCode('ORD', state.labOrders, 'orderCode'), consultationId: consultation.consultationId,
        patientId: patient.patientId, physicianId: consultation.physicianId, doctorAuthUserId: user.id, orderedBy: user.staffId,
        orderDate: timestamp, priority: input.priority, clinicalNotes: input.clinicalNotes || consultation.clinicalNotes, diagnosis: consultation.diagnosis,
        status: ORDER_STATUS.REQUESTED, displayStatus: ORDER_DISPLAY_STATUS.REQUESTED, signedAt: timestamp, revision: 1, createdAt: timestamp, updatedAt: null,
      };
      state.labOrders.push(order);
      panelIds.forEach((panelId) => state.orderPanels.push({ orderPanelId: id(), orderId: order.orderId, panelId, status: 'Pending', createdAt: timestamp }));
      [...testIds].forEach((testId, index) => {
        const panelLink = state.panelTests.find((link) => link.testId === testId && panelIds.includes(link.panelId));
        state.orderItems.push({ orderItemId: id(), orderId: order.orderId, panelId: panelLink?.panelId || null, testId, isRequired: panelLink?.isRequired ?? true, sortOrder: panelLink?.sortOrder ?? index + 1, status: 'REQUESTED', createdAt: timestamp });
      });
      state.statusHistory.push({ historyId: id(), entityType: 'LAB_ORDER', entityId: order.orderId, fromStatus: null, toStatus: ORDER_STATUS.REQUESTED, displayStatus: ORDER_DISPLAY_STATUS.REQUESTED, reason: null, actorUserId: user.id, createdAt: timestamp });
      audit(state, user, context, 'LAB_ORDER_CREATED', 'LAB_ORDER', order.orderId, { orderCode: order.orderCode, itemCount: testIds.size });
      return this.#orderView(state, order);
    });
  }

  async listOrders(user, query) {
    const state = await this.repository.snapshot();
    let orders = state.labOrders.filter((order) => this.#canReadOrder(state, user, order));
    if (query.patientId) orders = orders.filter((order) => order.patientId === query.patientId);
    return asList(orders.map((order) => {
      const latestResult = state.resultVersions
        .filter((version) => version.orderId === order.orderId)
        .sort((left, right) => right.versionNumber - left.versionNumber)[0];
      const patient = state.patients.find(item => item.patientId === order.patientId);
      const panels = state.orderPanels.filter(item => item.orderId === order.orderId);
      const panelCodes = panels.map(link => state.testPanels.find(panel => panel.panelId === link.panelId)?.panelCode).filter(Boolean);
      const testNames = state.orderItems.filter(item => item.orderId === order.orderId && !item.panelId)
        .map(item => state.testCatalog.find(test => test.testId === item.testId)?.testName).filter(Boolean);
      return { ...decorateOrder(order), patientName: patient ? [patient.firstName, patient.middleName, patient.lastName, patient.suffix].filter(Boolean).join(' ') : null, panelCodes, testNames, resultStatus: latestResult?.status || null, resultVersionId: latestResult?.resultVersionId || null };
    }), query);
  }

  async getOrder(user, orderId) {
    const state = await this.repository.snapshot();
    const order = assertFound(state.labOrders.find((item) => item.orderId === orderId), 'Laboratory order');
    assertCondition(this.#canReadOrder(state, user, order), 403, 'You are not authorized to access this order.', 'ORDER_ACCESS_DENIED');
    return this.#orderView(state, order);
  }

  async accessionOrder(orderId, input, user, context) {
    return this.repository.transact((state) => {
      const order = assertFound(state.labOrders.find((item) => item.orderId === orderId), 'Laboratory order');
      assertCondition([ORDER_STATUS.REQUESTED, ORDER_STATUS.PAYMENT_CLASSIFIED, ORDER_STATUS.RECOLLECTION_REQUIRED].includes(order.status), 409, 'Order is not ready for accession.', 'INVALID_ORDER_TRANSITION');
      const requested = input.specimens?.length ? input.specimens : [...new Set(state.orderItems.filter((item) => item.orderId === orderId).map((item) => state.testCatalog.find((test) => test.testId === item.testId)?.sampleTypeId).filter(Boolean))].map((sampleTypeId) => ({ sampleTypeId, condition: null, remarks: null }));
      assertCondition(requested.length > 0, 409, 'No sample type is available for accession.', 'SAMPLE_TYPE_REQUIRED');
      const accessionCode = nextCode('ACC', state.specimens, 'accessionCode');
      if (input.specimenCode) assertCondition(!state.specimens.some((item) => item.specimenCode.toLowerCase() === input.specimenCode.toLowerCase()), 409, 'Specimen code already exists.', 'SPECIMEN_CODE_CONFLICT');
      const specimens = requested.map((specimenInput, index) => {
        assertFound(state.sampleTypes.find((item) => item.sampleTypeId === specimenInput.sampleTypeId && item.isActive), 'Sample type');
        const specimenCode = input.specimenCode ? (index === 0 ? input.specimenCode : `${input.specimenCode}-${String(index + 1).padStart(2, '0')}`) : `${accessionCode}-${String(index + 1).padStart(2, '0')}`;
        const specimen = { specimenId: id(), specimenCode, accessionCode, orderId, sampleTypeId: specimenInput.sampleTypeId, collectedBy: null, collectedAt: null, receivedBy: null, receivedAt: null, specimenStatus: 'ACCESSIONED', condition: nullable(specimenInput.condition), remarks: nullable(specimenInput.remarks), rejectionReason: null, createdAt: now() };
        state.specimens.push(specimen);
        return specimen;
      });
      transitionOrder(order, ORDER_STATUS.ACCESSIONED, user.id, state.statusHistory, order.status === ORDER_STATUS.RECOLLECTION_REQUIRED ? 'Recollection accessioned' : null);
      audit(state, user, context, 'ORDER_ACCESSIONED', 'LAB_ORDER', orderId, { accessionCode, specimenCount: specimens.length });
      return { accessionCode, specimens, order: decorateOrder(order) };
    });
  }

  async collectSpecimen(specimenId, input, user, context) {
    return this.repository.transact((state) => {
      const specimen = assertFound(state.specimens.find((item) => item.specimenId === specimenId), 'Specimen');
      assertCondition(specimen.specimenStatus === 'ACCESSIONED', 409, 'Only an accessioned specimen may be collected.', 'INVALID_SPECIMEN_TRANSITION');
      const order = assertFound(state.labOrders.find((item) => item.orderId === specimen.orderId), 'Laboratory order');
      specimen.specimenStatus = 'COLLECTED'; specimen.collectedBy = user.staffId || user.id; specimen.collectedAt = input.collectedAt || now(); specimen.condition = input.condition; specimen.remarks = nullable(input.remarks);
      if (state.specimens.filter((item) => item.orderId === order.orderId && item.specimenStatus !== 'REJECTED').every((item) => item.specimenStatus === 'COLLECTED')) transitionOrder(order, ORDER_STATUS.COLLECTED, user.id, state.statusHistory);
      statusHistory(state, 'SPECIMEN', specimenId, 'ACCESSIONED', 'COLLECTED', user);
      audit(state, user, context, 'SPECIMEN_COLLECTED', 'SPECIMEN', specimenId, { orderId: order.orderId });
      return { specimen, order: decorateOrder(order) };
    });
  }

  async receiveSpecimen(specimenId, input, user, context) {
    return this.repository.transact((state) => {
      const specimen = assertFound(state.specimens.find((item) => item.specimenId === specimenId), 'Specimen');
      assertCondition(specimen.specimenStatus === 'COLLECTED', 409, 'Only a collected specimen may be received.', 'INVALID_SPECIMEN_TRANSITION');
      const order = assertFound(state.labOrders.find((item) => item.orderId === specimen.orderId), 'Laboratory order');
      specimen.specimenStatus = 'RECEIVED'; specimen.receivedBy = user.staffId || user.id; specimen.receivedAt = input.receivedAt || now(); if (input.condition !== undefined) specimen.condition = nullable(input.condition); if (input.remarks !== undefined) specimen.remarks = nullable(input.remarks);
      if (state.specimens.filter((item) => item.orderId === order.orderId && item.specimenStatus !== 'REJECTED').every((item) => item.specimenStatus === 'RECEIVED')) {
        transitionOrder(order, ORDER_STATUS.IN_TESTING, user.id, state.statusHistory);
        state.orderItems.filter((item) => item.orderId === order.orderId).forEach((item) => { item.status = 'IN_TESTING'; });
      }
      statusHistory(state, 'SPECIMEN', specimenId, 'COLLECTED', 'RECEIVED', user);
      audit(state, user, context, 'SPECIMEN_RECEIVED', 'SPECIMEN', specimenId, { orderId: order.orderId });
      return { specimen, order: decorateOrder(order) };
    });
  }

  async rejectSpecimen(specimenId, input, user, context) {
    return this.repository.transact((state) => {
      const specimen = assertFound(state.specimens.find((item) => item.specimenId === specimenId), 'Specimen');
      assertCondition(['ACCESSIONED', 'COLLECTED', 'RECEIVED'].includes(specimen.specimenStatus), 409, 'Specimen cannot be rejected in its current state.', 'INVALID_SPECIMEN_TRANSITION');
      const previous = specimen.specimenStatus;
      specimen.specimenStatus = 'REJECTED'; specimen.rejectionReason = input.reason; specimen.rejectedBy = user.staffId || user.id; specimen.rejectedAt = now();
      const order = assertFound(state.labOrders.find((item) => item.orderId === specimen.orderId), 'Laboratory order');
      if ([ORDER_STATUS.ACCESSIONED, ORDER_STATUS.COLLECTED].includes(order.status)) transitionOrder(order, ORDER_STATUS.RECOLLECTION_REQUIRED, user.id, state.statusHistory, input.reason);
      statusHistory(state, 'SPECIMEN', specimenId, previous, 'REJECTED', user, input.reason);
      audit(state, user, context, 'SPECIMEN_REJECTED', 'SPECIMEN', specimenId, { reason: input.reason });
      return { specimen, order: decorateOrder(order) };
    });
  }

  async collectOrderSpecimens(orderId, input, user, context) {
    return this.repository.transact((state) => {
      const order = assertFound(state.labOrders.find((item) => item.orderId === orderId), 'Laboratory order');
      assertCondition(order.status === ORDER_STATUS.ACCESSIONED, 409, 'Only an accessioned order may be collected.', 'INVALID_ORDER_TRANSITION');
      const specimens = state.specimens.filter((item) => item.orderId === orderId && item.specimenStatus === 'ACCESSIONED');
      assertCondition(specimens.length > 0, 409, 'The order has no accessioned specimen.', 'SPECIMEN_NOT_READY');
      const timestamp = input.collectedAt || now();
      for (const specimen of specimens) {
        specimen.specimenStatus = 'COLLECTED'; specimen.collectedBy = user.staffId || user.id; specimen.collectedAt = timestamp;
        specimen.condition = input.condition; specimen.remarks = nullable(input.remarks);
        statusHistory(state, 'SPECIMEN', specimen.specimenId, 'ACCESSIONED', 'COLLECTED', user);
      }
      transitionOrder(order, ORDER_STATUS.COLLECTED, user.id, state.statusHistory);
      audit(state, user, context, 'ORDER_SPECIMENS_COLLECTED', 'LAB_ORDER', orderId, { specimenCount: specimens.length });
      return { specimens, order: decorateOrder(order) };
    });
  }

  async receiveOrderSpecimens(orderId, input, user, context) {
    return this.repository.transact((state) => {
      const order = assertFound(state.labOrders.find((item) => item.orderId === orderId), 'Laboratory order');
      assertCondition(order.status === ORDER_STATUS.COLLECTED, 409, 'Only a collected order may be received.', 'INVALID_ORDER_TRANSITION');
      const specimens = state.specimens.filter((item) => item.orderId === orderId && item.specimenStatus === 'COLLECTED');
      assertCondition(specimens.length > 0, 409, 'The order has no collected specimen.', 'SPECIMEN_NOT_READY');
      const timestamp = input.receivedAt || now();
      for (const specimen of specimens) {
        specimen.specimenStatus = 'RECEIVED'; specimen.receivedBy = user.staffId || user.id; specimen.receivedAt = timestamp;
        if (input.condition !== undefined) specimen.condition = nullable(input.condition);
        if (input.remarks !== undefined) specimen.remarks = nullable(input.remarks);
        statusHistory(state, 'SPECIMEN', specimen.specimenId, 'COLLECTED', 'RECEIVED', user);
      }
      transitionOrder(order, ORDER_STATUS.IN_TESTING, user.id, state.statusHistory);
      state.orderItems.filter((item) => item.orderId === orderId).forEach((item) => { item.status = 'IN_TESTING'; });
      audit(state, user, context, 'ORDER_SPECIMENS_RECEIVED', 'LAB_ORDER', orderId, { specimenCount: specimens.length });
      return { specimens, order: decorateOrder(order) };
    });
  }

  async rejectOrderSpecimens(orderId, input, user, context) {
    return this.repository.transact((state) => {
      const order = assertFound(state.labOrders.find((item) => item.orderId === orderId), 'Laboratory order');
      const specimens = state.specimens.filter((item) => item.orderId === orderId && ['ACCESSIONED', 'COLLECTED', 'RECEIVED'].includes(item.specimenStatus));
      assertCondition(specimens.length > 0, 409, 'The order has no rejectable specimen.', 'INVALID_SPECIMEN_TRANSITION');
      for (const specimen of specimens) {
        const previous = specimen.specimenStatus;
        specimen.specimenStatus = 'REJECTED'; specimen.rejectionReason = input.reason;
        specimen.rejectedBy = user.staffId || user.id; specimen.rejectedAt = now();
        statusHistory(state, 'SPECIMEN', specimen.specimenId, previous, 'REJECTED', user, input.reason);
      }
      if ([ORDER_STATUS.ACCESSIONED, ORDER_STATUS.COLLECTED].includes(order.status)) transitionOrder(order, ORDER_STATUS.RECOLLECTION_REQUIRED, user.id, state.statusHistory, input.reason);
      audit(state, user, context, 'ORDER_SPECIMENS_REJECTED', 'LAB_ORDER', orderId, { reason: input.reason, specimenCount: specimens.length });
      return { specimens, order: decorateOrder(order) };
    });
  }

  async enterOrderResult(orderId, input, user, context) {
    return this.repository.transact((state) => {
      const order = assertFound(state.labOrders.find((item) => item.orderId === orderId), 'Laboratory order');
      if (order.status === ORDER_STATUS.COLLECTED) {
        const timestamp = now();
        const specimens = state.specimens.filter((item) => item.orderId === orderId && item.specimenStatus === 'COLLECTED');
        assertCondition(specimens.length > 0, 409, 'A collected specimen is required before testing.', 'SPECIMEN_NOT_READY');
        for (const specimen of specimens) {
          specimen.specimenStatus = 'RECEIVED'; specimen.receivedBy = user.staffId || user.id; specimen.receivedAt = timestamp;
          statusHistory(state, 'SPECIMEN', specimen.specimenId, 'COLLECTED', 'RECEIVED', user, 'Received at testing bench');
        }
        transitionOrder(order, ORDER_STATUS.IN_TESTING, user.id, state.statusHistory);
        state.orderItems.filter((item) => item.orderId === orderId).forEach((item) => { item.status = 'IN_TESTING'; });
      }
      assertCondition(order.status === ORDER_STATUS.IN_TESTING || order.correctionInProgress, 409, 'Order is not ready for result entry.', 'ORDER_NOT_IN_TESTING');
      const test = assertFound(state.testCatalog.find((item) => item.testCode.toLowerCase() === input.testCode.toLowerCase() && item.isActive), 'Catalog test');
      const orderItem = assertFound(state.orderItems.find((item) => item.orderId === orderId && item.testId === test.testId), 'Order item');
      let version = state.resultVersions.find((item) => item.orderId === orderId && [RESULT_VERSION_STATUS.DRAFT, RESULT_VERSION_STATUS.QC_PENDING].includes(item.status));
      if (!version) {
        const created = this.#createResultVersionInState(state, orderId, {}, user, context);
        version = state.resultVersions.find((item) => item.resultVersionId === created.resultVersionId);
      }
      assertCondition(!state.testAttempts.some((item) => item.resultVersionId === version.resultVersionId && item.testId === test.testId && !item.repeatTestId), 409, 'This test already has a result in the current version.', 'RESULT_ITEM_EXISTS');
      const attemptNumber = Math.max(0, ...state.testAttempts.filter((item) => item.orderItemId === orderItem.orderItemId).map((item) => item.attemptNumber)) + 1;
      const timestamp = now();
      const attempt = { testAttemptId: id(), orderItemId: orderItem.orderItemId, orderId, resultVersionId: version.resultVersionId, testId: test.testId, attemptNumber, status: 'COMPLETED', methodology: input.methodology || test.methodology, resultItemId: null, startedBy: user.id, startedAt: timestamp, completedBy: user.id, completedAt: timestamp };
      const patient = assertFound(state.patients.find((item) => item.patientId === order.patientId), 'Patient');
      const unit = input.unit || test.defaultUnit || null; const range = findReferenceRange(state, test, patient, order, unit);
      const resultItem = { resultItemId: id(), resultVersionId: version.resultVersionId, testAttemptId: attempt.testAttemptId, testId: test.testId, testNameSnapshot: input.testName || test.testName, resultValue: input.resultValue, numericValue: nullable(input.numericValue), unitSnapshot: unit, referenceRangeSnapshot: makeReferenceSnapshot(range), flag: deriveFlag(input.numericValue, range) || 'Abnormal', remarks: nullable(input.remarks), sortOrder: test.sortOrder, createdAt: timestamp, createdBy: user.id };
      attempt.resultItemId = resultItem.resultItemId;
      state.testAttempts.push(attempt); state.resultItems.push(resultItem); orderItem.status = 'RESULT_ENTERED';
      if (version.status === RESULT_VERSION_STATUS.DRAFT) setVersionStatus(state, version, RESULT_VERSION_STATUS.QC_PENDING, user);
      audit(state, user, context, 'RESULT_ENTERED', 'TEST_ATTEMPT', attempt.testAttemptId, { orderId, resultItemId: resultItem.resultItemId, flag: resultItem.flag });
      return { attempt, resultItem, resultVersion: decorateResultVersion(version), order: decorateOrder(order) };
    });
  }

  async recordOrderQc(orderId, input, user, context) {
    return this.repository.transact((state) => {
      const order = assertFound(state.labOrders.find((item) => item.orderId === orderId), 'Laboratory order');
      const version = assertFound(state.resultVersions.filter((item) => item.orderId === orderId && [RESULT_VERSION_STATUS.QC_PENDING, RESULT_VERSION_STATUS.DRAFT, RESULT_VERSION_STATUS.QC_FAILED].includes(item.status)).sort((a, b) => b.versionNumber - a.versionNumber)[0], 'Editable result version');
      const attempts = state.testAttempts.filter((item) => item.resultVersionId === version.resultVersionId && item.status === 'COMPLETED');
      assertCondition(attempts.length > 0, 409, 'QC requires at least one completed result.', 'QC_NOT_ALLOWED');
      const outcome = input.passed ? 'PASS' : 'FAIL';
      const checks = attempts.map((attempt) => {
        const check = { qcCheckId: id(), testAttemptId: attempt.testAttemptId, outcome, controlLot: nullable(input.controlLot), notes: nullable(input.notes || input.controlValue), performedBy: user.id, performedAt: now() };
        state.qcChecks.push(check); attempt.status = input.passed ? 'QC_PASSED' : 'QC_FAILED'; return check;
      });
      if (input.passed) setVersionStatus(state, version, RESULT_VERSION_STATUS.QC_PASSED, user, input.notes || null);
      else setVersionStatus(state, version, RESULT_VERSION_STATUS.QC_FAILED, user, input.notes || input.controlValue || 'QC failed');
      audit(state, user, context, `QC_${outcome}`, 'RESULT_VERSION', version.resultVersionId, { orderId, checkCount: checks.length });
      return { qcChecks: checks, resultVersion: decorateResultVersion(version), order: decorateOrder(order) };
    });
  }

  async startOrderRepeat(orderId, input, user, context) {
    const state = await this.repository.snapshot();
    const attempt = state.testAttempts
      .filter((item) => item.orderId === orderId && item.status === 'QC_FAILED')
      .sort((left, right) => right.attemptNumber - left.attemptNumber)[0];
    assertFound(attempt, 'Failed QC attempt');
    return this.createRepeat(attempt.testAttemptId, input, user, context);
  }

  async referOrderResult(orderId, input, user, context) {
    const state = await this.repository.snapshot();
    const matchingTest = input.testCode ? state.testCatalog.find((item) => item.testCode.toLowerCase() === input.testCode.toLowerCase()) : null;
    const attempt = state.testAttempts
      .filter((item) => item.orderId === orderId && ['COMPLETED', 'QC_FAILED'].includes(item.status) && (!matchingTest || item.testId === matchingTest.testId))
      .sort((left, right) => right.attemptNumber - left.attemptNumber)[0];
    assertFound(attempt, 'Referable test attempt');
    return this.createReferral(attempt.testAttemptId, input, user, context);
  }

  async submitOrder(orderId, user, context) {
    const state = await this.repository.snapshot();
    const version = state.resultVersions
      .filter((item) => item.orderId === orderId && [RESULT_VERSION_STATUS.DRAFT, RESULT_VERSION_STATUS.QC_PENDING, RESULT_VERSION_STATUS.QC_PASSED].includes(item.status))
      .sort((left, right) => right.versionNumber - left.versionNumber)[0];
    assertFound(version, 'Submittable result version');
    return this.submitVersion(version.resultVersionId, user, context);
  }

  async decideOrder(orderId, input, user, context) {
    const state = await this.repository.snapshot();
    const version = state.resultVersions
      .filter((item) => item.orderId === orderId && item.status === RESULT_VERSION_STATUS.FOR_VERIFICATION)
      .sort((left, right) => right.versionNumber - left.versionNumber)[0];
    assertFound(version, 'Submitted result version');
    if (input.decision === 'reject') return this.rejectVersion(version.resultVersionId, { reason: input.remarks || 'Rejected by laboratory supervisor.' }, user, context);
    return this.approveVersion(version.resultVersionId, { notes: input.remarks || null }, user, context);
  }

  async releaseOrder(orderId, input, user, context) {
    const state = await this.repository.snapshot();
    const version = state.resultVersions
      .filter((item) => item.orderId === orderId && item.status === RESULT_VERSION_STATUS.VERIFIED)
      .sort((left, right) => right.versionNumber - left.versionNumber)[0];
    assertFound(version, 'Verified result version');
    const result = await this.releaseVersion(version.resultVersionId, { notes: input.remarks ?? input.notes ?? null }, user, context);
    const finalState = await this.repository.snapshot();
    const release = finalState.releases.find((item) => item.resultVersionId === version.resultVersionId) || null;
    return { ...result, release, verificationToken: release?.verificationToken || null };
  }

  async reviewOrderRelease(orderId, input, user, context) {
    const state = await this.repository.snapshot();
    const release = state.releases.filter((item) => item.orderId === orderId).sort((left, right) => right.releasedAt.localeCompare(left.releasedAt))[0];
    assertFound(release, 'Release');
    const reviewNote = [input.interpretation || input.reviewNote, input.followUpPlan].filter(Boolean).join('\n\n');
    return this.recordDoctorReview(release.releaseId, { reviewNote }, user, context);
  }

  async createResultVersion(orderId, input, user, context) {
    return this.repository.transact((state) => this.#createResultVersionInState(state, orderId, input, user, context));
  }

  #createResultVersionInState(state, orderId, input, user, context) {
    const order = assertFound(state.labOrders.find((item) => item.orderId === orderId), 'Laboratory order');
    const correctionSource = input.correctionFromVersionId ? assertFound(state.resultVersions.find((item) => item.resultVersionId === input.correctionFromVersionId && item.orderId === orderId), 'Result version') : null;
    if (!correctionSource) assertCondition(order.status === ORDER_STATUS.IN_TESTING, 409, 'Result versions can only be created while testing.', 'ORDER_NOT_IN_TESTING');
    else assertCondition([RESULT_VERSION_STATUS.VERIFIED, RESULT_VERSION_STATUS.RELEASED, RESULT_VERSION_STATUS.SUPERSEDED].includes(correctionSource.status), 409, 'Only verified or released versions may be corrected.', 'CORRECTION_SOURCE_INVALID');
    assertCondition(!state.resultVersions.some((item) => item.orderId === orderId && [RESULT_VERSION_STATUS.DRAFT, RESULT_VERSION_STATUS.QC_PENDING, RESULT_VERSION_STATUS.QC_PASSED, RESULT_VERSION_STATUS.FOR_VERIFICATION].includes(item.status)), 409, 'An editable or submitted result version already exists.', 'OPEN_RESULT_VERSION_EXISTS');
    const patient = assertFound(state.patients.find((item) => item.patientId === order.patientId), 'Patient');
    const versionNumber = Math.max(0, ...state.resultVersions.filter((item) => item.orderId === orderId).map((item) => item.versionNumber)) + 1;
    const version = {
      resultVersionId: id(), orderId, versionNumber, reportCode: `${nextCode('RPT', state.resultVersions, 'reportCode')}-V${versionNumber}`,
      status: RESULT_VERSION_STATUS.DRAFT, displayStatus: RESULT_DISPLAY_STATUS.DRAFT, publicationStatus: PUBLICATION_STATUS.NOT_STARTED,
      patientSnapshot: versionPatientSnapshot(patient, order), correctionOfVersionId: correctionSource?.resultVersionId || null,
      submittedBy: null, submittedAt: null, verifiedBy: null, verifiedAt: null, releasedBy: null, releasedAt: null,
      contentHash: null, revision: 1, createdBy: user.id, createdAt: now(), updatedAt: null,
    };
    state.resultVersions.push(version);
    if (correctionSource) {
      state.resultItems.filter((item) => item.resultVersionId === correctionSource.resultVersionId).forEach((item) => state.resultItems.push({ ...structuredClone(item), resultItemId: id(), resultVersionId: version.resultVersionId, sourceResultItemId: item.resultItemId, createdAt: now() }));
      order.correctionInProgress = true;
    }
    statusHistory(state, 'RESULT_VERSION', version.resultVersionId, null, RESULT_VERSION_STATUS.DRAFT, user, correctionSource ? 'Correction version' : null);
    audit(state, user, context, correctionSource ? 'RESULT_CORRECTION_CREATED' : 'RESULT_VERSION_CREATED', 'RESULT_VERSION', version.resultVersionId, { orderId, versionNumber });
    return decorateResultVersion(version);
  }

  async createTestAttempt(orderItemId, input, user, context) {
    return this.repository.transact((state) => {
      const orderItem = assertFound(state.orderItems.find((item) => item.orderItemId === orderItemId), 'Order item');
      const order = assertFound(state.labOrders.find((item) => item.orderId === orderItem.orderId), 'Laboratory order');
      assertCondition(order.status === ORDER_STATUS.IN_TESTING || order.correctionInProgress, 409, 'Order is not ready for result entry.', 'ORDER_NOT_IN_TESTING');
      let version = input.resultVersionId ? assertFound(state.resultVersions.find((item) => item.resultVersionId === input.resultVersionId && item.orderId === order.orderId), 'Result version') : state.resultVersions.find((item) => item.orderId === order.orderId && item.status === RESULT_VERSION_STATUS.DRAFT);
      if (!version) version = this.#createResultVersionInState(state, order.orderId, {}, user, context);
      version = state.resultVersions.find((item) => item.resultVersionId === version.resultVersionId);
      assertCondition([RESULT_VERSION_STATUS.DRAFT, RESULT_VERSION_STATUS.QC_PENDING].includes(version.status), 409, 'Submitted result versions are immutable.', 'RESULT_VERSION_IMMUTABLE');
      const attemptNumber = Math.max(0, ...state.testAttempts.filter((item) => item.orderItemId === orderItemId).map((item) => item.attemptNumber)) + 1;
      const attempt = { testAttemptId: id(), orderItemId, orderId: order.orderId, resultVersionId: version.resultVersionId, testId: orderItem.testId, attemptNumber, status: 'IN_PROGRESS', methodology: nullable(input.methodology), resultItemId: null, startedBy: user.id, startedAt: now(), completedAt: null };
      state.testAttempts.push(attempt);
      orderItem.status = 'IN_TESTING';
      audit(state, user, context, 'TEST_ATTEMPT_STARTED', 'TEST_ATTEMPT', attempt.testAttemptId, { orderItemId, attemptNumber });
      return { attempt, resultVersion: decorateResultVersion(version) };
    });
  }

  async enterAttemptResult(testAttemptId, input, user, context) {
    return this.repository.transact((state) => {
      const attempt = assertFound(state.testAttempts.find((item) => item.testAttemptId === testAttemptId), 'Test attempt');
      assertCondition(attempt.status === 'IN_PROGRESS', 409, 'Completed attempts are immutable; create a repeat attempt instead.', 'TEST_ATTEMPT_IMMUTABLE');
      const version = assertFound(state.resultVersions.find((item) => item.resultVersionId === attempt.resultVersionId), 'Result version');
      assertCondition([RESULT_VERSION_STATUS.DRAFT, RESULT_VERSION_STATUS.QC_PENDING].includes(version.status), 409, 'Submitted result versions are immutable.', 'RESULT_VERSION_IMMUTABLE');
      const order = assertFound(state.labOrders.find((item) => item.orderId === attempt.orderId), 'Laboratory order');
      const patient = assertFound(state.patients.find((item) => item.patientId === order.patientId), 'Patient');
      const test = assertFound(state.testCatalog.find((item) => item.testId === attempt.testId), 'Catalog test');
      const unit = input.unit || test.defaultUnit || null;
      const range = findReferenceRange(state, test, patient, order, unit);
      const resultItem = {
        resultItemId: id(), resultVersionId: version.resultVersionId, testAttemptId, testId: test.testId,
        testNameSnapshot: test.testName, resultValue: input.resultValue, numericValue: nullable(input.numericValue), unitSnapshot: unit,
        referenceRangeSnapshot: makeReferenceSnapshot(range), flag: deriveFlag(input.numericValue, range) || 'Abnormal',
        remarks: nullable(input.remarks), sortOrder: test.sortOrder, createdAt: now(), createdBy: user.id,
      };
      state.resultItems.push(resultItem);
      attempt.status = 'COMPLETED'; attempt.resultItemId = resultItem.resultItemId; attempt.methodology = input.methodology || attempt.methodology; attempt.completedAt = now(); attempt.completedBy = user.id;
      if (version.status === RESULT_VERSION_STATUS.DRAFT) setVersionStatus(state, version, RESULT_VERSION_STATUS.QC_PENDING, user);
      const orderItem = state.orderItems.find((item) => item.orderItemId === attempt.orderItemId); orderItem.status = 'RESULT_ENTERED';
      audit(state, user, context, 'RESULT_ENTERED', 'TEST_ATTEMPT', testAttemptId, { resultItemId: resultItem.resultItemId, flag: resultItem.flag });
      return { attempt, resultItem, resultVersion: decorateResultVersion(version) };
    });
  }

  async replaceDraftItems(resultVersionId, input, user, context) {
    return this.repository.transact((state) => {
      const version = assertFound(state.resultVersions.find((item) => item.resultVersionId === resultVersionId), 'Result version');
      assertCondition([RESULT_VERSION_STATUS.DRAFT, RESULT_VERSION_STATUS.QC_PENDING].includes(version.status), 409, 'Submitted result versions are immutable.', 'RESULT_VERSION_IMMUTABLE');
      const order = assertFound(state.labOrders.find((item) => item.orderId === version.orderId), 'Laboratory order');
      const patient = assertFound(state.patients.find((item) => item.patientId === order.patientId), 'Patient');
      const existingAttempts = state.testAttempts.filter((attempt) => attempt.resultVersionId === resultVersionId);
      assertCondition(existingAttempts.every((attempt) => !['QC_PASSED', 'QC_FAILED'].includes(attempt.status)), 409, 'QC-recorded items cannot be overwritten.', 'QC_RESULT_IMMUTABLE');
      const attemptIds = new Set(existingAttempts.map((attempt) => attempt.testAttemptId));
      state.resultItems = state.resultItems.filter((item) => item.resultVersionId !== resultVersionId || !attemptIds.has(item.testAttemptId));
      state.testAttempts = state.testAttempts.filter((attempt) => attempt.resultVersionId !== resultVersionId);
      const created = input.items.map((itemInput) => {
        const orderItem = assertFound(state.orderItems.find((item) => item.orderId === order.orderId && item.testId === itemInput.testId), 'Order item');
        const test = assertFound(state.testCatalog.find((item) => item.testId === itemInput.testId), 'Catalog test');
        const attempt = { testAttemptId: id(), orderItemId: orderItem.orderItemId, orderId: order.orderId, resultVersionId, testId: test.testId, attemptNumber: Math.max(0, ...state.testAttempts.filter((item) => item.orderItemId === orderItem.orderItemId).map((item) => item.attemptNumber)) + 1, status: 'COMPLETED', methodology: test.methodology, resultItemId: null, startedBy: user.id, startedAt: now(), completedBy: user.id, completedAt: now() };
        const unit = itemInput.unit || test.defaultUnit || null;
        const range = findReferenceRange(state, test, patient, order, unit);
        const resultItem = { resultItemId: id(), resultVersionId, testAttemptId: attempt.testAttemptId, testId: test.testId, testNameSnapshot: test.testName, resultValue: itemInput.resultValue, numericValue: nullable(itemInput.numericValue), unitSnapshot: unit, referenceRangeSnapshot: makeReferenceSnapshot(range), flag: itemInput.flag || deriveFlag(itemInput.numericValue, range) || 'Abnormal', remarks: nullable(itemInput.remarks), sortOrder: test.sortOrder, createdAt: now(), createdBy: user.id };
        attempt.resultItemId = resultItem.resultItemId;
        state.testAttempts.push(attempt); state.resultItems.push(resultItem); orderItem.status = 'RESULT_ENTERED';
        return resultItem;
      });
      if (version.status === RESULT_VERSION_STATUS.DRAFT) setVersionStatus(state, version, RESULT_VERSION_STATUS.QC_PENDING, user);
      audit(state, user, context, 'DRAFT_RESULTS_REPLACED', 'RESULT_VERSION', resultVersionId, { itemCount: created.length });
      return { resultVersion: decorateResultVersion(version), items: created };
    });
  }

  async recordQc(testAttemptId, input, user, context) {
    return this.repository.transact((state) => {
      const attempt = assertFound(state.testAttempts.find((item) => item.testAttemptId === testAttemptId), 'Test attempt');
      assertCondition(attempt.status === 'COMPLETED', 409, 'QC requires a completed attempt and cannot be overwritten.', 'QC_NOT_ALLOWED');
      const version = assertFound(state.resultVersions.find((item) => item.resultVersionId === attempt.resultVersionId), 'Result version');
      assertCondition([RESULT_VERSION_STATUS.QC_PENDING, RESULT_VERSION_STATUS.DRAFT].includes(version.status), 409, 'QC cannot change an immutable version.', 'RESULT_VERSION_IMMUTABLE');
      const check = { qcCheckId: id(), testAttemptId, outcome: input.outcome, controlLot: nullable(input.controlLot), notes: nullable(input.notes), performedBy: user.id, performedAt: now() };
      state.qcChecks.push(check);
      attempt.status = input.outcome === 'PASS' ? 'QC_PASSED' : 'QC_FAILED';
      const versionAttempts = state.testAttempts.filter((item) => item.resultVersionId === version.resultVersionId);
      if (input.outcome === 'FAIL') setVersionStatus(state, version, RESULT_VERSION_STATUS.QC_FAILED, user, input.notes || 'QC failed');
      else {
        if (attempt.repeatTestId) {
          const repeat = state.repeatTests.find((item) => item.repeatTestId === attempt.repeatTestId);
          if (repeat) { repeat.status = 'COMPLETED'; repeat.completedAt = now(); }
        }
        if (versionAttempts.length > 0 && versionAttempts.every((item) => ['QC_PASSED', 'REFERRAL_INCORPORATED', 'REPEAT_REQUIRED'].includes(item.status))) setVersionStatus(state, version, RESULT_VERSION_STATUS.QC_PASSED, user);
      }
      audit(state, user, context, `QC_${input.outcome}`, 'TEST_ATTEMPT', testAttemptId, { qcCheckId: check.qcCheckId });
      return { qcCheck: check, attempt, resultVersion: decorateResultVersion(version) };
    });
  }

  async createRepeat(testAttemptId, input, user, context) {
    return this.repository.transact((state) => {
      const previousAttempt = assertFound(state.testAttempts.find((item) => item.testAttemptId === testAttemptId), 'Test attempt');
      assertCondition(previousAttempt.status === 'QC_FAILED', 409, 'A repeat requires a failed QC attempt.', 'REPEAT_NOT_REQUIRED');
      const version = assertFound(state.resultVersions.find((item) => item.resultVersionId === previousAttempt.resultVersionId), 'Result version');
      setVersionStatus(state, version, RESULT_VERSION_STATUS.REPEAT_REQUIRED, user, input.reason);
      previousAttempt.status = 'REPEAT_REQUIRED';
      const repeat = { repeatTestId: id(), sourceAttemptId: testAttemptId, status: 'IN_PROGRESS', reason: input.reason, requestedBy: user.id, requestedAt: now(), completedAt: null };
      const attemptNumber = Math.max(...state.testAttempts.filter((item) => item.orderItemId === previousAttempt.orderItemId).map((item) => item.attemptNumber)) + 1;
      const newAttempt = { testAttemptId: id(), orderItemId: previousAttempt.orderItemId, orderId: previousAttempt.orderId, resultVersionId: previousAttempt.resultVersionId, testId: previousAttempt.testId, attemptNumber, status: 'IN_PROGRESS', methodology: previousAttempt.methodology, resultItemId: null, repeatTestId: repeat.repeatTestId, startedBy: user.id, startedAt: now(), completedAt: null };
      repeat.newAttemptId = newAttempt.testAttemptId;
      state.repeatTests.push(repeat); state.testAttempts.push(newAttempt);
      setVersionStatus(state, version, RESULT_VERSION_STATUS.DRAFT, user, 'Repeat attempt started');
      audit(state, user, context, 'REPEAT_TEST_STARTED', 'REPEAT_TEST', repeat.repeatTestId, { sourceAttemptId: testAttemptId, newAttemptId: newAttempt.testAttemptId });
      return { repeat, attempt: newAttempt, resultVersion: decorateResultVersion(version) };
    });
  }

  async createReferral(testAttemptId, input, user, context) {
    return this.repository.transact((state) => {
      const attempt = assertFound(state.testAttempts.find((item) => item.testAttemptId === testAttemptId), 'Test attempt');
      assertCondition(['COMPLETED', 'QC_FAILED'].includes(attempt.status), 409, 'Attempt cannot be referred in its current state.', 'REFERRAL_NOT_ALLOWED');
      const version = assertFound(state.resultVersions.find((item) => item.resultVersionId === attempt.resultVersionId), 'Result version');
      assertCondition(![RESULT_VERSION_STATUS.FOR_VERIFICATION, RESULT_VERSION_STATUS.VERIFIED, RESULT_VERSION_STATUS.RELEASED].includes(version.status), 409, 'Submitted result versions are immutable.', 'RESULT_VERSION_IMMUTABLE');
      const referral = { referralId: id(), testAttemptId, referralLaboratory: input.referralLaboratory, reason: input.reason, status: 'SENT', sentAt: input.sentAt || now(), sentBy: user.id, resultReceivedAt: null, incorporatedAt: null };
      state.referrals.push(referral); attempt.status = 'REFERRED'; setVersionStatus(state, version, RESULT_VERSION_STATUS.REFERRED, user, input.reason);
      audit(state, user, context, 'TEST_REFERRED', 'REFERRAL', referral.referralId, { testAttemptId });
      return { referral, resultVersion: decorateResultVersion(version) };
    });
  }

  async incorporateReferralResult(referralId, input, user, context) {
    return this.repository.transact((state) => {
      const referral = assertFound(state.referrals.find((item) => item.referralId === referralId), 'Referral');
      assertCondition(referral.status === 'SENT', 409, 'Referral result was already incorporated.', 'REFERRAL_ALREADY_RESOLVED');
      const attempt = assertFound(state.testAttempts.find((item) => item.testAttemptId === referral.testAttemptId), 'Test attempt');
      const version = assertFound(state.resultVersions.find((item) => item.resultVersionId === attempt.resultVersionId), 'Result version');
      const order = assertFound(state.labOrders.find((item) => item.orderId === attempt.orderId), 'Laboratory order');
      const patient = assertFound(state.patients.find((item) => item.patientId === order.patientId), 'Patient');
      const test = assertFound(state.testCatalog.find((item) => item.testId === attempt.testId), 'Catalog test');
      const unit = input.unit || test.defaultUnit || null; const range = findReferenceRange(state, test, patient, order, unit);
      const resultItem = { resultItemId: id(), resultVersionId: version.resultVersionId, testAttemptId: attempt.testAttemptId, testId: test.testId, testNameSnapshot: test.testName, resultValue: input.resultValue, numericValue: nullable(input.numericValue), unitSnapshot: unit, referenceRangeSnapshot: makeReferenceSnapshot(range), flag: deriveFlag(input.numericValue, range) || 'Abnormal', remarks: input.notes || `Referral: ${referral.referralLaboratory}`, sortOrder: test.sortOrder, createdAt: now(), createdBy: user.id, referralId };
      state.resultItems.push(resultItem); attempt.status = 'REFERRAL_INCORPORATED'; attempt.resultItemId = resultItem.resultItemId; referral.status = 'INCORPORATED'; referral.resultReceivedAt = input.receivedAt || now(); referral.incorporatedAt = now(); referral.resultItemId = resultItem.resultItemId;
      const unresolved = state.referrals.some((item) => state.testAttempts.find((attemptItem) => attemptItem.testAttemptId === item.testAttemptId)?.resultVersionId === version.resultVersionId && item.status !== 'INCORPORATED');
      if (!unresolved) setVersionStatus(state, version, RESULT_VERSION_STATUS.QC_PASSED, user, 'Referral result incorporated');
      audit(state, user, context, 'REFERRAL_RESULT_INCORPORATED', 'REFERRAL', referralId, { resultItemId: resultItem.resultItemId });
      return { referral, resultItem, resultVersion: decorateResultVersion(version) };
    });
  }

  async submitVersion(resultVersionId, user, context) {
    return this.repository.transact((state) => {
      const version = assertFound(state.resultVersions.find((item) => item.resultVersionId === resultVersionId), 'Result version');
      assertCondition([RESULT_VERSION_STATUS.DRAFT, RESULT_VERSION_STATUS.QC_PASSED, RESULT_VERSION_STATUS.QC_PENDING].includes(version.status), 409, 'Result version cannot be submitted.', 'RESULT_SUBMISSION_NOT_ALLOWED');
      const order = assertFound(state.labOrders.find((item) => item.orderId === version.orderId), 'Laboratory order');
      const requiredItems = state.orderItems.filter((item) => item.orderId === order.orderId && item.isRequired);
      const latestAttempts = requiredItems.map((item) => state.testAttempts.filter((attempt) => attempt.orderItemId === item.orderItemId && attempt.resultVersionId === resultVersionId).sort((a, b) => b.attemptNumber - a.attemptNumber)[0]);
      assertCondition(latestAttempts.every((attempt) => attempt && ['QC_PASSED', 'REFERRAL_INCORPORATED'].includes(attempt.status)), 409, 'Every required item needs a passing QC attempt or incorporated referral result.', 'RESULTS_NOT_READY_FOR_SUBMISSION');
      assertCondition(!state.repeatTests.some((repeat) => latestAttempts.some((attempt) => attempt?.repeatTestId === repeat.repeatTestId) && !['COMPLETED', 'CLOSED'].includes(repeat.status)), 409, 'Required repeat testing is unresolved.', 'REPEAT_UNRESOLVED');
      setVersionStatus(state, version, RESULT_VERSION_STATUS.FOR_VERIFICATION, user);
      version.submittedBy = user.id; version.submittedAt = now(); version.contentHash = hash(buildCanonicalResultSnapshot(state, resultVersionId));
      if (!version.correctionOfVersionId) transitionOrder(order, ORDER_STATUS.FOR_VERIFICATION, user.id, state.statusHistory);
      audit(state, user, context, 'RESULT_VERSION_SUBMITTED', 'RESULT_VERSION', resultVersionId, { contentHash: version.contentHash });
      return { resultVersion: decorateResultVersion(version), order: decorateOrder(order) };
    });
  }

  async approveVersion(resultVersionId, input, user, context) {
    await this.repository.transact((state) => {
      const version = assertFound(state.resultVersions.find((item) => item.resultVersionId === resultVersionId), 'Result version');
      assertCondition(version.status === RESULT_VERSION_STATUS.FOR_VERIFICATION, 409, 'Only submitted results may be approved.', 'RESULT_APPROVAL_NOT_ALLOWED');
      assertCondition(version.submittedBy !== user.id, 403, 'The submitter cannot approve the same result version.', 'FOUR_EYES_REQUIRED');
      const order = assertFound(state.labOrders.find((item) => item.orderId === version.orderId), 'Laboratory order');
      setVersionStatus(state, version, RESULT_VERSION_STATUS.VERIFIED, user);
      version.verifiedBy = user.id; version.verifiedAt = now(); version.approvalNotes = nullable(input.notes);
      if (!version.correctionOfVersionId) {
        transitionOrder(order, ORDER_STATUS.APPROVED, user.id, state.statusHistory);
        transitionOrder(order, ORDER_STATUS.STORAGE_PENDING, user.id, state.statusHistory);
      }
      version.publicationStatus = PUBLICATION_STATUS.STORAGE_PENDING;
      const event = { outboxId: id(), type: 'STORE_APPROVED_RESULT', aggregateType: 'RESULT_VERSION', aggregateId: resultVersionId, status: 'PENDING', attempts: 0, nextAttemptAt: now(), lastError: null, requestedBy: user.id, createdAt: now(), completedAt: null };
      state.outbox.push(event);
      audit(state, user, context, 'RESULT_VERSION_APPROVED', 'RESULT_VERSION', resultVersionId, { outboxId: event.outboxId });
      return null;
    });
    await this.processPublication(resultVersionId);
    return this.getVersionForRole(user, resultVersionId);
  }

  async rejectVersion(resultVersionId, input, user, context) {
    return this.repository.transact((state) => {
      const version = assertFound(state.resultVersions.find((item) => item.resultVersionId === resultVersionId), 'Result version');
      assertCondition(version.status === RESULT_VERSION_STATUS.FOR_VERIFICATION, 409, 'Only submitted results may be rejected.', 'RESULT_REJECTION_NOT_ALLOWED');
      const order = assertFound(state.labOrders.find((item) => item.orderId === version.orderId), 'Laboratory order');
      setVersionStatus(state, version, RESULT_VERSION_STATUS.REJECTED, user, input.reason); version.rejectedBy = user.id; version.rejectedAt = now(); version.rejectionReason = input.reason;
      if (!version.correctionOfVersionId) transitionOrder(order, ORDER_STATUS.IN_TESTING, user.id, state.statusHistory, input.reason);
      const draft = this.#cloneVersion(state, version, user, 'Rejection correction');
      audit(state, user, context, 'RESULT_VERSION_REJECTED', 'RESULT_VERSION', resultVersionId, { reason: input.reason, nextVersionId: draft.resultVersionId });
      return { rejectedVersion: decorateResultVersion(version), draftVersion: decorateResultVersion(draft), order: decorateOrder(order) };
    });
  }

  async createCorrection(resultVersionId, user, context) {
    return this.repository.transact((state) => {
      const source = assertFound(state.resultVersions.find((item) => item.resultVersionId === resultVersionId), 'Result version');
      assertCondition([RESULT_VERSION_STATUS.VERIFIED, RESULT_VERSION_STATUS.RELEASED, RESULT_VERSION_STATUS.SUPERSEDED].includes(source.status), 409, 'Only verified or released results may be corrected.', 'CORRECTION_NOT_ALLOWED');
      assertCondition(!state.resultVersions.some((item) => item.orderId === source.orderId && [RESULT_VERSION_STATUS.DRAFT, RESULT_VERSION_STATUS.QC_PENDING, RESULT_VERSION_STATUS.FOR_VERIFICATION].includes(item.status)), 409, 'Another correction is already in progress.', 'OPEN_RESULT_VERSION_EXISTS');
      const draft = this.#cloneVersion(state, source, user, 'Post-approval correction');
      state.labOrders.find((item) => item.orderId === source.orderId).correctionInProgress = true;
      audit(state, user, context, 'RESULT_CORRECTION_CREATED', 'RESULT_VERSION', draft.resultVersionId, { correctionOfVersionId: source.resultVersionId });
      return decorateResultVersion(draft);
    });
  }

  #cloneVersion(state, source, user, reason) {
    const versionNumber = Math.max(...state.resultVersions.filter((item) => item.orderId === source.orderId).map((item) => item.versionNumber)) + 1;
    const draft = { ...structuredClone(source), resultVersionId: id(), versionNumber, reportCode: `${source.reportCode.replace(/-V\d+$/, '')}-V${versionNumber}`, status: RESULT_VERSION_STATUS.DRAFT, displayStatus: RESULT_DISPLAY_STATUS.DRAFT, publicationStatus: PUBLICATION_STATUS.NOT_STARTED, correctionOfVersionId: source.resultVersionId, submittedBy: null, submittedAt: null, verifiedBy: null, verifiedAt: null, releasedBy: null, releasedAt: null, rejectedBy: null, rejectedAt: null, rejectionReason: null, contentHash: null, revision: 1, createdBy: user.id, createdAt: now(), updatedAt: null };
    state.resultVersions.push(draft);
    state.resultItems.filter((item) => item.resultVersionId === source.resultVersionId).forEach((item) => state.resultItems.push({ ...structuredClone(item), resultItemId: id(), resultVersionId: draft.resultVersionId, sourceResultItemId: item.resultItemId, testAttemptId: null, createdAt: now(), createdBy: user.id }));
    statusHistory(state, 'RESULT_VERSION', draft.resultVersionId, null, RESULT_VERSION_STATUS.DRAFT, user, reason);
    return draft;
  }

  async processPublication(resultVersionId) {
    let state = await this.repository.snapshot();
    let version = assertFound(state.resultVersions.find((item) => item.resultVersionId === resultVersionId), 'Result version');
    let storeEvent = state.outbox.find((event) => event.aggregateId === resultVersionId && event.type === 'STORE_APPROVED_RESULT' && ['PENDING', 'RETRY_WAIT'].includes(event.status));
    if (storeEvent) {
      try {
        const snapshot = buildCanonicalResultSnapshot(state, resultVersionId);
        const order = state.labOrders.find((item) => item.orderId === version.orderId);
        const receipt = await this.publicationClients.storePackage({ snapshot, opaqueRecordId: order.opaqueRecordId, version: version.versionNumber, idempotencyKey: storeEvent.outboxId });
        await this.repository.transact((draft) => {
          const draftVersion = draft.resultVersions.find((item) => item.resultVersionId === resultVersionId);
          const draftOrder = draft.labOrders.find((item) => item.orderId === draftVersion.orderId);
          const event = draft.outbox.find((item) => item.outboxId === storeEvent.outboxId);
          event.status = 'COMPLETED'; event.completedAt = now(); event.attempts += 1;
          const ciphertextHash = receipt.ciphertextHash || receipt.envelopeHash || receipt.sha256 || receipt.hash;
          const protectedObjectReference = receipt.protectedObjectReference;
          assertCondition(ciphertextHash && protectedObjectReference, 502, 'Storage receipt is incomplete.', 'STORAGE_RECEIPT_INVALID');
          draft.publicationReceipts.push({ receiptId: id(), type: 'STORAGE', resultVersionId, outboxId: event.outboxId, opaqueRecordId: draftOrder.opaqueRecordId, version: draftVersion.versionNumber, ciphertextHash, protectedObjectReference, rawReceipt: receipt, receivedAt: now() });
          draftVersion.publicationStatus = PUBLICATION_STATUS.STORED; draftVersion.ciphertextHash = ciphertextHash; draftVersion.protectedObjectReference = protectedObjectReference;
          if (!draftVersion.correctionOfVersionId) {
            if (draftOrder.status === ORDER_STATUS.STORAGE_PENDING) transitionOrder(draftOrder, ORDER_STATUS.STORED, event.requestedBy, draft.statusHistory);
            if (draftOrder.status === ORDER_STATUS.STORED) transitionOrder(draftOrder, ORDER_STATUS.LEDGER_PENDING, event.requestedBy, draft.statusHistory);
          }
          draftVersion.publicationStatus = PUBLICATION_STATUS.LEDGER_PENDING;
          if (!draft.outbox.some((item) => item.aggregateId === resultVersionId && item.type === 'REGISTER_LEDGER')) draft.outbox.push({ outboxId: id(), type: 'REGISTER_LEDGER', aggregateType: 'RESULT_VERSION', aggregateId: resultVersionId, status: 'PENDING', attempts: 0, nextAttemptAt: now(), lastError: null, requestedBy: event.requestedBy, createdAt: now(), completedAt: null });
          return null;
        });
      } catch (error) {
        await this.#failOutbox(storeEvent.outboxId, error);
        return { status: 'RETRY_WAIT', stage: 'STORAGE', error: error.message };
      }
    }

    state = await this.repository.snapshot(); version = state.resultVersions.find((item) => item.resultVersionId === resultVersionId);
    const ledgerEvent = state.outbox.find((event) => event.aggregateId === resultVersionId && event.type === 'REGISTER_LEDGER' && ['PENDING', 'RETRY_WAIT'].includes(event.status));
    if (ledgerEvent) {
      try {
        const order = state.labOrders.find((item) => item.orderId === version.orderId);
        const receipt = await this.publicationClients.registerLedger({ opaqueRecordId: order.opaqueRecordId, version: version.versionNumber, ciphertextHash: version.ciphertextHash, protectedObjectReference: version.protectedObjectReference, approvedAt: version.verifiedAt, idempotencyKey: ledgerEvent.outboxId });
        await this.repository.transact((draft) => {
          const draftVersion = draft.resultVersions.find((item) => item.resultVersionId === resultVersionId);
          const draftOrder = draft.labOrders.find((item) => item.orderId === draftVersion.orderId);
          const event = draft.outbox.find((item) => item.outboxId === ledgerEvent.outboxId);
          event.status = 'COMPLETED'; event.completedAt = now(); event.attempts += 1;
          draft.publicationReceipts.push({ receiptId: id(), type: 'LEDGER_REGISTRATION', resultVersionId, outboxId: event.outboxId, opaqueRecordId: draftOrder.opaqueRecordId, version: draftVersion.versionNumber, transactionId: receipt.transactionId || receipt.txId || receipt.id, rawReceipt: receipt, receivedAt: now() });
          draftVersion.publicationStatus = PUBLICATION_STATUS.REGISTERED; draftVersion.ledgerTransactionId = receipt.transactionId || receipt.txId || receipt.id;
          if (!draftVersion.correctionOfVersionId && draftOrder.status === ORDER_STATUS.LEDGER_PENDING) transitionOrder(draftOrder, ORDER_STATUS.LEDGER_REGISTERED, event.requestedBy, draft.statusHistory);
          return null;
        });
      } catch (error) {
        await this.#failOutbox(ledgerEvent.outboxId, error);
        return { status: 'RETRY_WAIT', stage: 'LEDGER', error: error.message };
      }
    }
    const finalState = await this.repository.snapshot(); const finalVersion = finalState.resultVersions.find((item) => item.resultVersionId === resultVersionId);
    return { status: finalVersion.publicationStatus, stage: finalVersion.publicationStatus };
  }

  async releaseVersion(resultVersionId, input, user, context) {
    const event = await this.repository.transact((state) => {
      const version = assertFound(state.resultVersions.find((item) => item.resultVersionId === resultVersionId), 'Result version');
      assertCondition(version.status === RESULT_VERSION_STATUS.VERIFIED, 409, 'Only a verified version may be released.', 'RESULT_RELEASE_NOT_ALLOWED');
      assertCondition(version.publicationStatus === PUBLICATION_STATUS.REGISTERED, 409, 'Release requires a completed ledger registration.', 'LEDGER_REGISTRATION_REQUIRED');
      const order = assertFound(state.labOrders.find((item) => item.orderId === version.orderId), 'Laboratory order');
      if (!version.correctionOfVersionId) assertCondition(order.status === ORDER_STATUS.LEDGER_REGISTERED, 409, 'Order is not ledger registered.', 'LEDGER_REGISTRATION_REQUIRED');
      const outboxEvent = { outboxId: id(), type: 'RELEASE_LEDGER', aggregateType: 'RESULT_VERSION', aggregateId: resultVersionId, status: 'PENDING', attempts: 0, nextAttemptAt: now(), lastError: null, requestedBy: user.id, notes: nullable(input.notes), createdAt: now(), completedAt: null };
      state.outbox.push(outboxEvent); version.publicationStatus = PUBLICATION_STATUS.RELEASE_PENDING;
      audit(state, user, context, 'RESULT_RELEASE_REQUESTED', 'RESULT_VERSION', resultVersionId, { outboxId: outboxEvent.outboxId });
      return outboxEvent;
    });
    await this.#processReleaseEvent(event.outboxId);
    return this.getVersionForRole(user, resultVersionId);
  }

  async #processReleaseEvent(outboxId) {
    const state = await this.repository.snapshot();
    const event = assertFound(state.outbox.find((item) => item.outboxId === outboxId), 'Outbox event');
    const version = assertFound(state.resultVersions.find((item) => item.resultVersionId === event.aggregateId), 'Result version');
    const order = assertFound(state.labOrders.find((item) => item.orderId === version.orderId), 'Laboratory order');
    try {
      const receipt = await this.publicationClients.releaseLedger({ opaqueRecordId: order.opaqueRecordId, version: version.versionNumber, releaseTimestamp: event.createdAt, idempotencyKey: event.outboxId });
      await this.repository.transact((draft) => {
        const draftEvent = draft.outbox.find((item) => item.outboxId === outboxId);
        const draftVersion = draft.resultVersions.find((item) => item.resultVersionId === event.aggregateId);
        const draftOrder = draft.labOrders.find((item) => item.orderId === draftVersion.orderId);
        draftEvent.status = 'COMPLETED'; draftEvent.completedAt = now(); draftEvent.attempts += 1;
        const verificationToken = receipt.verificationToken || receipt.qrToken || receipt.token || null;
        draft.publicationReceipts.push({ receiptId: id(), type: 'LEDGER_RELEASE', resultVersionId: draftVersion.resultVersionId, outboxId, opaqueRecordId: draftOrder.opaqueRecordId, version: draftVersion.versionNumber, transactionId: receipt.transactionId || receipt.txId || receipt.id, verificationToken, rawReceipt: receipt, receivedAt: now() });
        setVersionStatus(draft, draftVersion, RESULT_VERSION_STATUS.RELEASED, { id: draftEvent.requestedBy, roles: ['LAB_SUPERVISOR'] });
        draftVersion.releasedBy = draftEvent.requestedBy; draftVersion.releasedAt = now(); draftVersion.publicationStatus = PUBLICATION_STATUS.COMPLETE;
        if (draftVersion.correctionOfVersionId) {
          const source = draft.resultVersions.find((item) => item.resultVersionId === draftVersion.correctionOfVersionId);
          if (source?.status === RESULT_VERSION_STATUS.RELEASED) setVersionStatus(draft, source, RESULT_VERSION_STATUS.SUPERSEDED, { id: draftEvent.requestedBy, roles: ['LAB_SUPERVISOR'] }, `Superseded by version ${draftVersion.versionNumber}`);
          draftOrder.correctionInProgress = false;
        } else if (draftOrder.status === ORDER_STATUS.LEDGER_REGISTERED) transitionOrder(draftOrder, ORDER_STATUS.RELEASED, draftEvent.requestedBy, draft.statusHistory);
        const report = { reportId: id(), reportCode: draftVersion.reportCode, orderId: draftOrder.orderId, patientId: draftOrder.patientId, specimenId: draft.specimens.find((item) => item.orderId === draftOrder.orderId && item.specimenStatus !== 'REJECTED')?.specimenId || null, panelId: draft.orderPanels.find((item) => item.orderId === draftOrder.orderId)?.panelId || null, facilityId: draft.facilities[0]?.facilityId || null, reportedBy: draftVersion.submittedBy, verifiedBy: draftVersion.verifiedBy, pathologistId: draftVersion.verifiedBy, registeredAt: draftOrder.createdAt, collectedAt: draft.specimens.find((item) => item.orderId === draftOrder.orderId)?.collectedAt || null, receivedAt: draft.specimens.find((item) => item.orderId === draftOrder.orderId)?.receivedAt || null, reportedAt: draftVersion.submittedAt, releasedAt: draftVersion.releasedAt, reportStatus: 'Released', qrToken: verificationToken, qrCodePath: null, pdfPath: receipt.pdfPath || null, remarks: draftEvent.notes };
        draft.labReports.push(report);
        const release = { releaseId: id(), resultVersionId: draftVersion.resultVersionId, reportId: report.reportId, orderId: draftOrder.orderId, releasedBy: draftEvent.requestedBy, releasedAt: draftVersion.releasedAt, ledgerReceiptId: draft.publicationReceipts.at(-1).receiptId, verificationToken: report.qrToken };
        draft.releases.push(release);
        return null;
      });
      return { status: 'COMPLETE' };
    } catch (error) {
      await this.#failOutbox(outboxId, error);
      return { status: 'RETRY_WAIT', error: error.message };
    }
  }

  async #failOutbox(outboxId, error) {
    await this.repository.transact((state) => {
      const event = state.outbox.find((item) => item.outboxId === outboxId);
      if (!event) return null;
      event.attempts += 1; event.lastError = error.message; event.status = event.attempts >= 10 ? 'FAILED_REVIEW' : 'RETRY_WAIT'; event.nextAttemptAt = new Date(Date.now() + Math.min(3600, 2 ** event.attempts * 5) * 1000).toISOString();
      const version = state.resultVersions.find((item) => item.resultVersionId === event.aggregateId);
      if (version) version.publicationStatus = event.status === 'FAILED_REVIEW' ? PUBLICATION_STATUS.FAILED_REVIEW : PUBLICATION_STATUS.RETRY_WAIT;
      return null;
    });
  }

  async getVersionForRole(user, resultVersionId) {
    const state = await this.repository.snapshot();
    const version = assertFound(state.resultVersions.find((item) => item.resultVersionId === resultVersionId), 'Result version');
    const order = assertFound(state.labOrders.find((item) => item.orderId === version.orderId), 'Laboratory order');
    assertCondition(this.#canReadOrder(state, user, order), 403, 'You are not authorized to read this result.', 'RESULT_ACCESS_DENIED');
    return { resultVersion: decorateResultVersion(version), items: state.resultItems.filter((item) => item.resultVersionId === resultVersionId), order: decorateOrder(order), publicationReceipts: state.publicationReceipts.filter((item) => item.resultVersionId === resultVersionId) };
  }

  async recordDoctorReview(releaseId, input, user, context) {
    return this.repository.transact((state) => {
      const release = assertFound(state.releases.find((item) => item.releaseId === releaseId), 'Release');
      const order = assertFound(state.labOrders.find((item) => item.orderId === release.orderId), 'Laboratory order');
      assertCondition(order.doctorAuthUserId === user.id, 403, 'Only the assigned doctor may review this result.', 'DOCTOR_ASSIGNMENT_REQUIRED');
      assertCondition(!state.doctorReviews.some((item) => item.releaseId === releaseId && item.doctorAuthUserId === user.id), 409, 'Doctor review is append-only and already exists.', 'DOCTOR_REVIEW_EXISTS');
      const review = { doctorReviewId: id(), releaseId, orderId: order.orderId, resultVersionId: release.resultVersionId, doctorAuthUserId: user.id, reviewNote: input.reviewNote, reviewedAt: now() };
      state.doctorReviews.push(review); audit(state, user, context, 'DOCTOR_REVIEW_RECORDED', 'RELEASE', releaseId);
      return review;
    });
  }

  async ownReleasedResults(user) {
    const state = await this.repository.snapshot(); const patientIds = this.#patientIdsForUser(state, user);
    assertCondition(patientIds.length > 0, 403, 'No patient record is linked to this account.', 'PATIENT_ACCOUNT_NOT_LINKED');
    const versions = state.resultVersions.filter((version) => version.status === RESULT_VERSION_STATUS.RELEASED && patientIds.includes(state.labOrders.find((order) => order.orderId === version.orderId)?.patientId));
    return versions.map((version) => {
      const order = state.labOrders.find((item) => item.orderId === version.orderId);
      const patient = state.patients.find((item) => item.patientId === order.patientId);
      const report = state.labReports.find((item) => item.orderId === order.orderId && item.reportCode === version.reportCode);
      const release = state.releases.find((item) => item.resultVersionId === version.resultVersionId);
      const specimen = state.specimens.find((item) => item.orderId === order.orderId && item.specimenStatus !== 'REJECTED');
      const panelNames = state.orderPanels
        .filter((item) => item.orderId === order.orderId)
        .map((item) => state.testPanels.find((panel) => panel.panelId === item.panelId)?.panelName)
        .filter(Boolean);
      const verificationToken = release?.verificationToken || report?.qrToken || null;
      return {
        id: version.resultVersionId,
        recordId: order.opaqueRecordId,
        reportId: report?.reportId || null,
        reportCode: version.reportCode,
        panelName: panelNames.join(', ') || 'Laboratory report',
        status: 'Released',
        collectedAt: report?.collectedAt || specimen?.collectedAt || null,
        releasedAt: version.releasedAt,
        version: version.versionNumber,
        verificationToken,
        verificationUrl: verificationToken ? `${this.config.publicBaseUrl}/verify/${verificationToken}` : null,
        patient: patient ? {
          patientId: patient.patientId,
          patientCode: patient.patientCode,
          fullName: [patient.firstName, patient.middleName, patient.lastName, patient.suffix].filter(Boolean).join(' '),
        } : null,
        resultVersion: decorateResultVersion(version),
        order: decorateOrder(order),
        items: state.resultItems.filter((item) => item.resultVersionId === version.resultVersionId),
      };
    });
  }

  async ownReleasedResult(user, resultVersionId) {
    const items = await this.ownReleasedResults(user); return assertFound(items.find((item) => item.resultVersion.resultVersionId === resultVersionId), 'Released result');
  }

  async listAudit(query) {
    const state = await this.repository.snapshot(); let records = state.audits;
    if (query.actorUserId) records = records.filter((item) => item.actorUserId === query.actorUserId);
    if (query.status) records = records.filter((item) => item.action === query.status);
    if (query.orderId) records = records.filter((item) => item.entityId === query.orderId || item.metadata?.orderId === query.orderId);
    if (query.q) {
      const term = query.q.toLowerCase();
      records = records.filter((item) => [item.action, item.entityType, item.entityId, item.actorUserId, ...(item.actorRoles || [])]
        .some((value) => String(value || '').toLowerCase().includes(term)));
    }
    const views = records.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((item) => ({
      ...item,
      id: item.auditId,
      role: item.actorRoles?.join(', ') || null,
      recordType: item.entityType,
      recordId: item.entityId,
      timestamp: item.createdAt,
    }));
    return asList(views, query);
  }

  async listOutbox(query) {
    const state = await this.repository.snapshot(); return asList(state.outbox.sort((a, b) => b.createdAt.localeCompare(a.createdAt)), query);
  }

  async retryOutbox(outboxId) {
    const state = await this.repository.snapshot(); const event = assertFound(state.outbox.find((item) => item.outboxId === outboxId), 'Outbox event');
    assertCondition(['RETRY_WAIT', 'FAILED_REVIEW', 'PENDING'].includes(event.status), 409, 'Completed outbox events cannot be retried.', 'OUTBOX_RETRY_NOT_ALLOWED');
    await this.repository.transact((draft) => { const item = draft.outbox.find((candidate) => candidate.outboxId === outboxId); item.status = 'PENDING'; item.nextAttemptAt = now(); return null; });
    if (event.type === 'RELEASE_LEDGER') return this.#processReleaseEvent(outboxId);
    return this.processPublication(event.aggregateId);
  }

  async syncBatch(input, user, context) {
    return this.repository.transact((state) => {
      const receipts = [];
      for (const operation of input.operations) {
        const duplicate = state.syncOperations.find((item) => item.operationId === operation.operationId);
        if (duplicate) {
          receipts.push(state.syncReceipts.find((item) => item.operationId === operation.operationId));
          continue;
        }
        let status = 'APPLIED'; let message = 'Operation applied.';
        const allowed = (operation.entityType === 'PATIENT' || operation.entityType === 'VISIT') ? hasRole(user, 'REGISTRATION_CASHIER') : operation.entityType === 'CONSULTATION' ? hasRole(user, 'DOCTOR') : hasRole(user, 'LAB_STAFF');
        if (!allowed) { status = 'CONFLICT'; message = 'Role cannot synchronize this entity type.'; }
        const collectionName = { PATIENT: 'patients', VISIT: 'visits', CONSULTATION: 'consultations', RESULT_DRAFT: 'resultVersions' }[operation.entityType];
        const collection = state[collectionName];
        const keyName = { PATIENT: 'patientId', VISIT: 'visitId', CONSULTATION: 'consultationId', RESULT_DRAFT: 'resultVersionId' }[operation.entityType];
        const existing = collection.find((item) => item[keyName] === operation.entityId);
        if (allowed && operation.action === 'CREATE' && existing) { status = 'DUPLICATE'; message = 'Entity already exists.'; }
        else if (allowed && operation.action === 'UPDATE' && (!existing || (existing.revision || 0) !== operation.baseRevision)) { status = 'CONFLICT'; message = 'Entity revision conflict.'; }
        else if (allowed && operation.action === 'CREATE') collection.push({ ...operation.payload, [keyName]: operation.entityId, revision: 1, syncCreatedBy: user.id, createdAt: now() });
        else if (allowed && operation.action === 'UPDATE') Object.assign(existing, operation.payload, { revision: existing.revision + 1, updatedAt: now() });
        const receipt = { receiptId: id(), operationId: operation.operationId, deviceId: input.deviceId, actorUserId: user.id, entityType: operation.entityType, entityId: operation.entityId, status, message, serverRevision: existing?.revision || (status === 'APPLIED' ? 1 : null), receivedAt: now() };
        state.syncOperations.push({ ...operation, deviceId: input.deviceId, actorUserId: user.id, status, receivedAt: receipt.receivedAt }); state.syncReceipts.push(receipt); receipts.push(receipt);
      }
      audit(state, user, context, 'SYNC_BATCH_PROCESSED', 'SYNC_BATCH', input.deviceId, { operationCount: input.operations.length });
      return { receipts };
    });
  }

  async getSyncReceipt(receiptId, user) {
    const state = await this.repository.snapshot(); const receipt = assertFound(state.syncReceipts.find((item) => item.receiptId === receiptId), 'Sync receipt');
    assertCondition(receipt.actorUserId === user.id || hasRole(user, 'SYSTEM_ADMIN'), 403, 'You cannot access this sync receipt.', 'SYNC_RECEIPT_ACCESS_DENIED');
    return receipt;
  }

  async readiness() {
    const database = await this.repository.ping();
    return { status: database.ok ? 'ready' : 'not_ready', service: 'records-service', database, dependencies: { storage: this.config.storageServiceUrl, verification: this.config.verificationServiceUrl }, timestamp: now() };
  }

  #patientIdsForUser(state, user) {
    const ids = state.patientAccountLinks.filter((item) => item.authUserId === user.id).map((item) => item.patientId);
    if (user.patientId && state.patientAccountLinks.some((item) => item.authUserId === user.id && item.patientId === user.patientId)) ids.push(user.patientId);
    return [...new Set(ids)];
  }

  #assertPatientReadable(state, user, patientId) {
    if (hasRole(user, 'REGISTRATION_CASHIER')) return;
    if (hasRole(user, 'DOCTOR') && state.visits.some(visit => visit.patientId === patientId && visit.status === 'OPEN' && !state.consultations.some(item => item.visitId === visit.visitId))) return;
    if (hasRole(user, 'DOCTOR') && state.consultations.some((item) => item.patientId === patientId && item.doctorAuthUserId === user.id)) return;
    if ((hasRole(user, 'LAB_STAFF') || hasRole(user, 'LAB_SUPERVISOR')) && state.labOrders.some((item) => item.patientId === patientId)) return;
    throw new ApiError(403, 'You are not authorized to access this patient.', 'PATIENT_ACCESS_DENIED');
  }

  #canReadOrder(state, user, order) {
    if (hasRole(user, 'REGISTRATION_CASHIER') || hasRole(user, 'LAB_STAFF') || hasRole(user, 'LAB_SUPERVISOR')) return true;
    if (hasRole(user, 'DOCTOR')) return order.doctorAuthUserId === user.id;
    if (hasRole(user, 'PATIENT')) return order.status === ORDER_STATUS.RELEASED && this.#patientIdsForUser(state, user).includes(order.patientId);
    return false;
  }

  #orderView(state, order) {
    return {
      ...decorateOrder(order),
      payment: state.payments.find((item) => item.orderId === order.orderId) || null,
      panels: state.orderPanels.filter((item) => item.orderId === order.orderId),
      items: state.orderItems.filter((item) => item.orderId === order.orderId).map((item) => ({ ...item, test: state.testCatalog.find((test) => test.testId === item.testId) })),
      specimens: state.specimens.filter((item) => item.orderId === order.orderId),
      resultVersions: state.resultVersions.filter((item) => item.orderId === order.orderId).map(decorateResultVersion),
      statusHistory: state.statusHistory.filter((item) => item.entityType === 'LAB_ORDER' && item.entityId === order.orderId),
    };
  }
}
