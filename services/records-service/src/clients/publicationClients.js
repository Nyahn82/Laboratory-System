import { ApiError } from '../errors.js';

async function requestJson(url, { method = 'POST', body, token, idempotencyKey, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-internal-service-token': token,
        'x-caller-service': 'records-service',
        'idempotency-key': idempotencyKey,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new ApiError(502, payload.message || `Publication dependency returned HTTP ${response.status}.`, 'PUBLICATION_DEPENDENCY_FAILED');
    }
    return payload.data ?? payload;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(502, `Publication dependency is unavailable: ${error.message}`, 'PUBLICATION_DEPENDENCY_UNAVAILABLE');
  } finally {
    clearTimeout(timer);
  }
}

export function createPublicationClients(config) {
  return {
    async storePackage({ snapshot, opaqueRecordId, version, idempotencyKey }) {
      return requestJson(`${config.storageServiceUrl}/packages`, {
        body: { recordId: opaqueRecordId, version, record: snapshot },
        token: config.internalServiceToken,
        idempotencyKey,
        timeoutMs: config.clientTimeoutMs,
      });
    },
    async registerLedger({ opaqueRecordId, version, ciphertextHash, protectedObjectReference, approvedAt, idempotencyKey }) {
      return requestJson(`${config.verificationServiceUrl}/registrations`, {
        body: {
          recordId: opaqueRecordId,
          version,
          documentHash: ciphertextHash,
          encryptedCidReference: protectedObjectReference,
          approvalTimestamp: approvedAt,
          issuingOrganization: 'RHU Laboratory Department',
          transactionMetadata: { source: 'records-service' },
        },
        token: config.internalServiceToken,
        idempotencyKey,
        timeoutMs: config.clientTimeoutMs,
      });
    },
    async releaseLedger({ opaqueRecordId, version, releaseTimestamp, idempotencyKey }) {
      return requestJson(`${config.verificationServiceUrl}/records/${encodeURIComponent(opaqueRecordId)}/versions/${version}/release`, {
        body: { releaseTimestamp },
        token: config.internalServiceToken,
        idempotencyKey,
        timeoutMs: config.clientTimeoutMs,
      });
    },
  };
}
