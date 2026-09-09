export const USER_STATUSES = Object.freeze({
  ACTIVE: 'ACTIVE',
  DISABLED: 'DISABLED',
  LOCKED: 'LOCKED',
});

export const ROLE_DEFINITIONS = Object.freeze([
  {
    code: 'SYSTEM_ADMIN',
    name: 'System administrator',
    description: 'Manages identities, roles, configuration, service health, and audit review.',
    permissions: [
      'auth.users.read',
      'auth.users.write',
      'auth.roles.read',
      'auth.sessions.revoke',
      'auth.audit.read',
    ],
  },
  {
    code: 'REGISTRATION_CASHIER',
    name: 'Registration staff',
    description: 'Registers patients, creates visits, and tracks laboratory requests.',
    permissions: ['workflow.patients.write', 'workflow.visits.write'],
  },
  {
    code: 'DOCTOR',
    name: 'Doctor',
    description: 'Creates consultations and signed orders and reviews authorized released results.',
    permissions: ['workflow.consultations.write', 'workflow.orders.write', 'workflow.doctor-results.read', 'workflow.doctor-reviews.write'],
  },
  {
    code: 'LAB_STAFF',
    name: 'Laboratory staff',
    description: 'Processes specimens, enters results, and records quality control.',
    permissions: ['workflow.specimens.write', 'workflow.results.write', 'workflow.qc.write'],
  },
  {
    code: 'LAB_SUPERVISOR',
    name: 'Laboratory supervisor',
    description: 'Approves, rejects, releases, revokes, and corrects laboratory result versions.',
    permissions: ['workflow.results.read', 'workflow.results.approve', 'workflow.results.release', 'workflow.results.correct'],
  },
  {
    code: 'PATIENT',
    name: 'Patient',
    description: 'Views and downloads the authenticated patient account’s released records.',
    permissions: ['workflow.own-records.read', 'auth.own-access-history.read'],
  },
  {
    code: 'PUBLIC_VERIFIER',
    name: 'Public verifier',
    description: 'Reads only redacted authenticity responses through public verification.',
    permissions: ['verification.public.read'],
  },
]);

export const ROLE_CODES = Object.freeze(ROLE_DEFINITIONS.map((role) => role.code));

export const ROLE_BY_CODE = Object.freeze(
  Object.fromEntries(ROLE_DEFINITIONS.map((role) => [role.code, role])),
);
