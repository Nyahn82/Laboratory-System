import { z } from 'zod';
import { RESULT_FLAGS } from './domain/statuses.js';

const nullableString = (max) => z.string().trim().max(max).nullable().optional();
const dateTime = z.string().datetime({ offset: true }).optional();

export const idParams = z.object({ id: z.string().min(1).max(128) });
export const patientIdParams = z.object({ patientId: z.string().min(1).max(128) });

export const patientAddressSchema = z.object({
  houseNumber: nullableString(60),
  street: z.string().trim().min(1).max(200),
  barangay: z.string().trim().min(1).max(120),
  municipality: z.literal("M'lang").default("M'lang"),
  province: nullableString(120),
  region: nullableString(120),
  postalCode: nullableString(20),
  country: nullableString(80),
}).strict();

export const patientCreateSchema = z.object({
  patientCode: z.string().trim().min(3).max(20).optional(),
  firstName: z.string().trim().min(1).max(60),
  middleName: nullableString(60),
  lastName: z.string().trim().min(1).max(60),
  suffix: nullableString(20),
  birthDate: z.string().date().nullable().optional(),
  sex: z.enum(['M', 'F', 'Other']).nullable().optional(),
  civilStatus: nullableString(20),
  nationality: nullableString(60),
  contactNumber: nullableString(30),
  email: z.string().email().max(254).nullable().optional(),
  address: z.string().trim().max(2000).nullable().optional(),
  addressDetails: patientAddressSchema.nullable().optional(),
});
export const patientRegistrationSchema = patientCreateSchema.extend({ reasonForVisit: z.string().trim().min(1).max(1000).optional() });
export const patientUpdateSchema = patientCreateSchema.partial().refine((value) => Object.keys(value).length > 0, 'At least one field is required.');
export const accountLinkSchema = z.object({ authUserId: z.string().min(1).max(128) });

export const visitSchema = z.object({
  patientId: z.string().min(1).max(128),
  visitDate: dateTime,
  visitType: z.enum(['Outpatient', 'Emergency', 'Referral']).default('Outpatient'),
  chiefComplaint: nullableString(1000),
});

export const consultationSchema = z.object({
  visitId: z.string().min(1).max(128),
  patientId: z.string().min(1).max(128),
  clinicalNotes: z.string().trim().min(1).max(5000),
  diagnosis: z.string().trim().min(1).max(2000),
});
export const consultationUpdateSchema = z.object({ clinicalNotes: z.string().trim().min(1).max(5000).optional(), diagnosis: z.string().trim().min(1).max(2000).optional() }).refine((value) => Object.keys(value).length > 0);

// The gateway-facing API keeps the concise Phase One contract used by the web
// application. These schemas deliberately map to the richer versioned domain
// commands instead of maintaining a second workflow implementation.
export const directConsultationSchema = z.object({
  visitId: z.string().max(128).optional().transform(value => value || undefined),
  patientId: z.string().min(1).max(128),
  chiefComplaint: nullableString(1000),
  clinicalNotes: z.string().trim().min(1).max(5000),
  assessment: z.string().trim().min(1).max(2000),
  plan: nullableString(2000),
});
export const consultationRequestSchema = z.union([consultationSchema, directConsultationSchema]);

export const orderSchema = z.object({
  consultationId: z.string().min(1).max(128),
  panelIds: z.array(z.string().min(1).max(128)).max(20).default([]),
  testIds: z.array(z.string().min(1).max(128)).max(100).default([]),
  priority: z.enum(['Routine', 'STAT', 'Urgent']).default('Routine'),
  clinicalNotes: nullableString(5000),
}).refine((value) => value.panelIds.length + value.testIds.length > 0, 'At least one panel or test is required.');

export const directOrderSchema = z.object({
  patientId: z.string().min(1).max(128).optional(),
  consultationId: z.string().min(1).max(128),
  panelCodes: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  testCodes: z.array(z.string().trim().min(1).max(40)).max(100).default([]),
  priority: z.enum(['Routine', 'STAT', 'Urgent']).default('Routine'),
  clinicalReason: nullableString(5000),
}).refine((value) => value.panelCodes.length + value.testCodes.length > 0, 'At least one panel or test code is required.');
export const orderRequestSchema = z.union([orderSchema, directOrderSchema]);

export const accessionSchema = z.object({
  specimens: z.array(z.object({ sampleTypeId: z.string().min(1).max(128), condition: nullableString(120), remarks: nullableString(500) })).max(20).optional(),
});
export const collectSchema = z.object({ collectedAt: dateTime, condition: z.string().trim().min(1).max(120), remarks: nullableString(500) });
export const receiveSchema = z.object({ receivedAt: dateTime, condition: nullableString(120), remarks: nullableString(500) });
export const rejectSchema = z.object({ reason: z.string().trim().min(3).max(500) });
export const directAccessionSchema = z.object({
  sampleType: z.string().trim().min(1).max(120),
  specimenCode: z.string().trim().min(3).max(40).optional(),
  condition: nullableString(120),
  remarks: nullableString(500),
});

export const resultVersionCreateSchema = z.object({ correctionFromVersionId: z.string().min(1).max(128).optional() }).default({});
export const attemptCreateSchema = z.object({ resultVersionId: z.string().min(1).max(128).optional(), methodology: nullableString(150) }).default({});
export const attemptUpdateSchema = z.object({
  resultValue: z.string().trim().min(1).max(50),
  numericValue: z.number().finite().nullable().optional(),
  unit: nullableString(50),
  methodology: nullableString(150),
  remarks: nullableString(2000),
});
export const resultItemsSchema = z.object({
  items: z.array(z.object({
    testId: z.string().min(1).max(128),
    resultValue: z.string().trim().min(1).max(50),
    numericValue: z.number().finite().nullable().optional(),
    unit: nullableString(50),
    flag: z.enum(RESULT_FLAGS).optional(),
    remarks: nullableString(2000),
  })).min(1).max(200),
});
export const qcSchema = z.object({ outcome: z.enum(['PASS', 'FAIL']), controlLot: nullableString(80), notes: nullableString(1000) });
export const repeatSchema = z.object({ reason: z.string().trim().min(3).max(1000) });
export const referralSchema = z.object({ referralLaboratory: z.string().trim().min(2).max(180), reason: z.string().trim().min(3).max(1000), sentAt: dateTime });
export const referralResultSchema = z.object({ resultValue: z.string().trim().min(1).max(50), numericValue: z.number().finite().nullable().optional(), unit: nullableString(50), receivedAt: dateTime, notes: nullableString(1000) });
export const approvalSchema = z.object({ notes: nullableString(2000) }).default({});
export const rejectionSchema = z.object({ reason: z.string().trim().min(3).max(2000) });
export const releaseSchema = z.object({ notes: nullableString(2000), remarks: nullableString(2000) }).default({});
export const doctorReviewSchema = z.object({ reviewNote: z.string().trim().min(1).max(3000) });

export const directResultSchema = z.object({
  testCode: z.string().trim().min(1).max(40),
  testName: z.string().trim().min(1).max(150).optional(),
  resultValue: z.string().trim().min(1).max(50),
  numericValue: z.number().finite().nullable().optional(),
  unit: nullableString(50),
  referenceRange: nullableString(120),
  methodology: nullableString(150),
  remarks: nullableString(2000),
});
export const directQcSchema = z.object({
  passed: z.boolean(),
  controlLot: nullableString(80),
  controlValue: nullableString(120),
  notes: nullableString(1000),
});
export const directApprovalSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  remarks: nullableString(2000),
});
export const directDoctorReviewSchema = z.object({
  acknowledgment: z.literal(true),
  interpretation: z.string().trim().min(1).max(3000),
  followUpPlan: nullableString(3000),
});

const sortableFields = ['createdAt', 'updatedAt', 'patientCode', 'lastName', 'visitDate', 'orderDate', 'orderCode', 'priority', 'status', 'displayStatus', 'action'];

export const paginationQuery = z.object({
  actorUserId: z.string().min(1).max(128).optional(),
  patientId: z.string().max(128).optional(),
  orderId: z.string().max(128).optional(),
  status: z.string().max(80).optional(),
  q: z.string().trim().max(120).optional(),
  search: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  sort: z.enum(sortableFields).optional(),
  direction: z.enum(['asc', 'desc']).default('desc'),
}).transform((value) => {
  const limit = value.pageSize ?? value.limit ?? 50;
  const page = value.page ?? Math.floor((value.offset ?? 0) / limit) + 1;
  return {
    ...value,
    q: value.search || value.q,
    limit,
    offset: value.offset ?? (page - 1) * limit,
    page,
    pageSize: limit,
  };
});

export const syncBatchSchema = z.object({
  deviceId: z.string().min(3).max(128),
  operations: z.array(z.object({
    operationId: z.string().uuid(),
    entityType: z.enum(['PATIENT', 'VISIT', 'CONSULTATION', 'RESULT_DRAFT']),
    entityId: z.string().min(1).max(128),
    baseRevision: z.number().int().nonnegative(),
    action: z.enum(['CREATE', 'UPDATE']),
    payload: z.record(z.any()),
  })).min(1).max(100),
});
