export const workspaces = {
  SYSTEM_ADMIN: {
    title: 'Administration', home: '/accounts', description: 'Manage staff access, monitor services, and keep the system running.',
    groups: [
      ['Administration', ['/accounts', '/audit']], ['System', ['/nodes', '/health', '/sync', '/backup']],
    ],
    tasks: [['/accounts', 'Manage accounts', 'Create accounts and maintain role assignments.'], ['/health', 'Check system health', 'Review the availability of supporting services.'], ['/audit', 'Review audit trail', 'Trace access and administrative activity.']],
  },
  REGISTRATION_CASHIER: {
    title: 'Registration', home: '/patients', description: 'Register patients, maintain identity details, and track laboratory requests.',
    groups: [['Front desk', ['/patients', '/orders']], ['Support', ['/sync']]],
    tasks: [['/patients', 'Register or find a patient', 'Maintain patient identity and contact details.'], ['/orders', 'Track laboratory requests', 'Check request progress when assisting patients.']],
    metrics: [['patients', 'Registered patients', '/patients'], ['pendingRequests', 'New requests', '/orders']],
  },
  DOCTOR: {
    title: 'Doctor workspace', home: '/dashboard', description: 'Document consultations, request laboratory tests, and review released results.',
    groups: [['Patient care', ['/consultations', '/orders', '/doctor-review']], ['Reference & support', ['/patients', '/sync']]],
    tasks: [['/consultations', 'Open a consultation', 'Document the patient encounter and clinical assessment.'], ['/orders', 'Create a laboratory request', 'Sign the tests required for your consultation.'], ['/doctor-review', 'Review released results', 'Record your interpretation and follow-up plan.']],
    metrics: [['orders', 'Authorized requests', '/orders'], ['releasedToday', 'Released today', '/doctor-review']],
  },
  LAB_STAFF: {
    title: 'Laboratory bench', home: '/dashboard', description: 'Collect specimens, enter results, complete quality control, and submit finished work.',
    groups: [['Bench workflow', ['/specimens', '/testing', '/quality-control', '/result-submission']], ['Exceptions', ['/repeat-referral']], ['Reference & support', ['/orders', '/patients', '/sync']]],
    tasks: [['/specimens', 'Collect specimens', 'Accession requests and record specimen collection.'], ['/testing', 'Enter test results', 'Record measured values and reference ranges.'], ['/quality-control', 'Complete quality control', 'Record controls before submitting results.'], ['/result-submission', 'Submit completed results', 'Send results that passed QC to the supervisor.']],
    metrics: [['awaitingCollection', 'Awaiting collection', '/specimens'], ['testingInProgress', 'Testing in progress', '/testing']],
  },
  LAB_SUPERVISOR: {
    title: 'Supervisor workspace', home: '/dashboard', description: 'Review submitted work, approve result versions, and release completed reports.',
    groups: [['Review & release', ['/supervisor-review', '/release']], ['Reference & oversight', ['/orders', '/patients', '/audit']]],
    tasks: [['/supervisor-review', 'Review submitted results', 'Approve a result version or return it for correction.'], ['/release', 'Release approved reports', 'Release reports once storage and verification are complete.'], ['/audit', 'Review workflow history', 'Trace decisions and result status changes.']],
    metrics: [['awaitingApproval', 'Awaiting your review', '/supervisor-review'], ['releasedToday', 'Released today', '/release']],
  },
  PATIENT: {
    title: 'My patient portal', home: '/patient-portal', description: 'View your released laboratory reports and share their verification QR.',
    groups: [['My records', ['/patient-portal', '/patient-history', '/qr']]], tasks: [],
  },
  PUBLIC_VERIFIER: {
    title: 'Record verification', home: '/dashboard', description: 'Check the authenticity of a laboratory report using its verification link or token.',
    groups: [], tasks: [],
  },
};

export const navigation = {
  '/patients': 'Patients', '/consultations': 'Consultations', '/orders': 'Lab requests',
  '/specimens': 'Specimens', '/testing': 'Result entry', '/quality-control': 'Quality control',
  '/repeat-referral': 'Repeat & referral', '/result-submission': 'Submit results', '/supervisor-review': 'Supervisor review',
  '/release': 'Result release', '/doctor-review': 'Doctor review', '/patient-portal': 'My laboratory records',
  '/patient-history': 'My history', '/qr': 'Verification QR', '/accounts': 'Accounts', '/nodes': 'Nodes', '/audit': 'Audit trail',
  '/sync': 'Offline sync', '/health': 'System health', '/backup': 'Backup & restore',
};

export function assignedRoles(user) {
  return (user?.roles || (user?.role ? [user.role] : [])).filter((role) => workspaces[role]);
}

export function canOpen(role, path) {
  return Boolean(workspaces[role]?.groups.some(([, paths]) => paths.includes(path)));
}
