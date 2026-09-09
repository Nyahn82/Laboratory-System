let accessToken = sessionStorage.getItem('labchain.accessToken') || '';
let refreshPromise = null;

export function setAccessToken(token) {
  accessToken = token || '';
  if (accessToken) sessionStorage.setItem('labchain.accessToken', accessToken);
  else sessionStorage.removeItem('labchain.accessToken');
}

export class ApiClientError extends Error {
  constructor(message, status = 0, errors = [], code = '') {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.errors = errors;
    this.code = code;
  }
}

async function parseResponse(response) {
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await response.json() : null;
  if (!response.ok || payload?.success === false) {
    const first = Array.isArray(payload?.errors) ? payload.errors[0] : null;
    throw new ApiClientError(
      payload?.message || first?.message || `Request failed with status ${response.status}.`,
      response.status,
      payload?.errors || [],
      first?.code || '',
    );
  }
  return payload?.data ?? payload ?? {};
}

async function fetchJson(path, options, timeoutMs = 15000) {
  const controller = new AbortController();
  const parentSignal = options.signal;
  const abort = () => controller.abort();
  if (parentSignal?.aborted) abort();
  else parentSignal?.addEventListener('abort', abort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  try {
    const response = await fetch(path, { ...options, signal: controller.signal });
    return await parseResponse(response);
  } catch (error) {
    if (error instanceof ApiClientError) throw error;
    if (timedOut) throw new ApiClientError('The request timed out. Please retry.', 408, [], 'REQUEST_TIMEOUT');
    if (parentSignal?.aborted) throw new ApiClientError('Request cancelled.', 499, [], 'REQUEST_CANCELLED');
    throw new ApiClientError(navigator.onLine ? 'The local service could not be reached.' : 'You are offline. The action can be saved to the sync queue.', 0, [], navigator.onLine ? 'SERVICE_UNAVAILABLE' : 'OFFLINE');
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener('abort', abort);
  }
}

async function refreshAccessToken() {
  if (!refreshPromise) {
    refreshPromise = fetchJson('/api/auth/refresh', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
      .then((data) => {
        setAccessToken(data.accessToken);
        return data.accessToken;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

export async function apiRequest(path, options = {}) {
  const {
    method = 'GET',
    body,
    headers = {},
    idempotencyKey,
    retryAuth = true,
    signal,
    timeoutMs = 15000,
  } = options;
  const requestHeaders = { accept: 'application/json', ...headers };
  if (body !== undefined) requestHeaders['content-type'] = 'application/json';
  if (accessToken) requestHeaders.authorization = `Bearer ${accessToken}`;
  if (idempotencyKey) requestHeaders['idempotency-key'] = idempotencyKey;

  try {
    return await fetchJson(path, {
      method,
      credentials: 'include',
      headers: requestHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    }, timeoutMs);
  } catch (error) {
    if (error.status !== 401 || !retryAuth || path.endsWith('/login') || path.endsWith('/refresh')) throw error;
    try {
      await refreshAccessToken();
    } catch (refreshError) {
      // A slow connection does not mean the account session was revoked.
      if (refreshError.status === 401 || refreshError.status === 403) {
        setAccessToken('');
        window.dispatchEvent(new CustomEvent('labchain:session-expired'));
      }
      throw refreshError;
    }
    return apiRequest(path, { ...options, retryAuth: false });
  }
}

export const authApi = {
  login: (email, password) => apiRequest('/api/auth/login', { method: 'POST', body: { email, password }, retryAuth: false }),
  me: () => apiRequest('/api/auth/me'),
  logout: () => apiRequest('/api/auth/logout', { method: 'POST', body: {} }).finally(() => setAccessToken('')),
  changePassword: (currentPassword, newPassword) => apiRequest('/api/auth/password/change', { method: 'POST', body: { currentPassword, newPassword } }),
  users: (offset = 0) => apiRequest(`/api/auth/users?limit=25&offset=${offset}`),
  user: (id) => apiRequest(`/api/auth/users/${encodeURIComponent(id)}`),
  userAudit: (id, offset = 0) => apiRequest(`/api/auth/users/${encodeURIComponent(id)}/audit?limit=25&offset=${offset}`),
  roles: () => apiRequest('/api/auth/roles'),
  createUser: (body) => apiRequest('/api/auth/users', { method: 'POST', body }),
  setUserStatus: (id, status) => apiRequest(`/api/auth/users/${id}/status`, { method: 'PATCH', body: { status } }),
};

export const recordsApi = {
  dashboard: () => apiRequest('/api/records/dashboard'),
  patients: (query = '') => apiRequest(`/api/records/patients${query ? `?search=${encodeURIComponent(query)}` : ''}`),
  patient: (id) => apiRequest(`/api/records/patients/${id}`),
  requestPatients: (search = '', page = 1) => apiRequest(`/api/records/request-patients?${new URLSearchParams({ search, page, pageSize: 20 })}`),
  catalog: () => apiRequest('/api/records/catalog'),
  createPatient: (body, key) => apiRequest('/api/records/patients', { method: 'POST', body, idempotencyKey: key }),
  visits: (status = '') => apiRequest(`/api/records/visits${status ? `?status=${encodeURIComponent(status)}` : ''}`),
  consultations: () => apiRequest('/api/records/consultations'),
  createConsultation: (body, key) => apiRequest('/api/records/consultations', { method: 'POST', body, idempotencyKey: key }),
  orders: (status = '') => apiRequest(`/api/records/orders${status ? `?status=${encodeURIComponent(status)}` : ''}`),
  createOrder: (body, key) => apiRequest('/api/records/orders', { method: 'POST', body, idempotencyKey: key }),
  order: (id) => apiRequest(`/api/records/orders/${id}`),
  command: (id, command, body, key) => apiRequest(`/api/records/orders/${id}/${command}`, { method: 'POST', body, idempotencyKey: key }),
  audit: (query = '') => apiRequest(`/api/records/audit${query}`),
  outbox: () => apiRequest('/api/records/sync/outbox'),
  retryOutbox: (id) => apiRequest(`/api/records/sync/outbox/${id}/retry`, { method: 'POST', body: {}, idempotencyKey: crypto.randomUUID() }),
  ownResults: () => apiRequest('/api/records/me/results'),
};

export const verificationApi = {
  nodes: () => apiRequest('/api/verification/nodes'),
  verify: (token) => apiRequest(`/api/verification/public/${encodeURIComponent(token)}`, { retryAuth: false }),
  history: (id) => apiRequest(`/api/verification/records/${id}/history`),
};

export const healthApi = {
  all: () => Promise.allSettled([
    ['Authentication', apiRequest('/api/auth/health', { retryAuth: false })],
    ['Records & Sync', apiRequest('/api/records/health', { retryAuth: false })],
    ['Encrypted Storage', apiRequest('/api/storage/health', { retryAuth: false })],
    ['Verification', apiRequest('/api/verification/health', { retryAuth: false })],
  ].map(async ([name, promise]) => ({ name, ...(await promise) }))),
};
