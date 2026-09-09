import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest, setAccessToken } from '../api/client.js';
const json = (status, data) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const pendingFetch = (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))));
beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('fetch', vi.fn()); setAccessToken('original-token'); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); setAccessToken(''); });
describe('API request timeouts', () => {
  it('ends a stalled request with a retryable timeout', async () => {
    fetch.mockImplementation(pendingFetch);
    const result = apiRequest('/api/records/patients', { method: 'POST', body: {}, idempotencyKey: 'same-patient-key' });
    const assertion = expect(result).rejects.toMatchObject({ status: 408, code: 'REQUEST_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(15000);
    await assertion;
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
  });
  it('also bounds a stalled response body', async () => {
    fetch.mockImplementation((_url, { signal }) => Promise.resolve({ ok: true, headers: new Headers({ 'content-type': 'application/json' }), json: () => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))) }));
    const assertion = expect(apiRequest('/api/records/patients')).rejects.toMatchObject({ status: 408 });
    await vi.advanceTimersByTimeAsync(15000); await assertion;
  });
  it('times out session refresh without signing out a valid user', async () => {
    fetch.mockResolvedValueOnce(json(401, { success: false })).mockImplementationOnce(pendingFetch);
    const assertion = expect(apiRequest('/api/records/patients')).rejects.toMatchObject({ status: 408 });
    await vi.advanceTimersByTimeAsync(15000); await assertion;
    expect(sessionStorage.getItem('labchain.accessToken')).toBe('original-token');
  });
  it('retries authentication using the same registration key', async () => {
    fetch.mockResolvedValueOnce(json(401, { success: false })).mockResolvedValueOnce(json(200, { data: { accessToken: 'refreshed-token' } })).mockResolvedValueOnce(json(201, { data: { patientId: 'patient-1' } }));
    const result=await apiRequest('/api/records/patients', { method: 'POST', body: { firstName: 'Test' }, idempotencyKey: 'original-key' });
    expect(result.patientId).toBe('patient-1');
    expect(fetch.mock.calls[2][1].headers).toMatchObject({ authorization: 'Bearer refreshed-token', 'idempotency-key': 'original-key' });
    await vi.advanceTimersByTimeAsync(15000);
    expect(fetch.mock.calls[2][1].signal.aborted).toBe(false);
  });
  it('preserves server validation errors', async () => {
    fetch.mockResolvedValueOnce(json(400, { success: false, message: 'Invalid address' }));
    await expect(apiRequest('/api/records/patients')).rejects.toMatchObject({ status: 400, message: 'Invalid address' });
  });
});
