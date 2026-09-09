import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonicalJson } from '../src/crypto/canonical-json.js';
import { decryptRecord, encryptRecord, sha256Buffer } from '../src/crypto/envelope.js';

describe('canonical encrypted envelopes', () => {
  const masterKey = randomBytes(32);
  const input = { z: [3, { beta: true, alpha: 'safe' }], a: 1 };

  it('canonicalizes object keys deterministically', () => {
    expect(canonicalJson(input)).toBe(canonicalJson({ a: 1, z: [3, { alpha: 'safe', beta: true }] }));
  });

  it('round-trips a record with AES-256-GCM', () => {
    const encrypted = encryptRecord({
      recordId: 'record-0001',
      version: 1,
      canonicalRecord: canonicalJson(input),
      masterKey,
      masterKeyId: 'test-key',
    });
    expect(decryptRecord({
      bytes: encrypted.bytes,
      expectedHash: encrypted.envelopeHash,
      masterKey,
      expectedRecordId: 'record-0001',
      expectedVersion: 1,
    })).toEqual(input);
  });

  it('uses fresh data and wrap nonces for every encryption', () => {
    const first = encryptRecord({ recordId: 'record-0001', version: 1, canonicalRecord: canonicalJson(input), masterKey, masterKeyId: 'test-key' });
    const second = encryptRecord({ recordId: 'record-0001', version: 1, canonicalRecord: canonicalJson(input), masterKey, masterKeyId: 'test-key' });
    expect(first.envelope.nonce).not.toBe(second.envelope.nonce);
    expect(first.envelope.keyWrap.nonce).not.toBe(second.envelope.keyWrap.nonce);
    expect(first.envelope.ciphertext).not.toBe(second.envelope.ciphertext);
  });

  it('rejects altered bytes and an altered authentication tag', () => {
    const encrypted = encryptRecord({ recordId: 'record-0001', version: 1, canonicalRecord: canonicalJson(input), masterKey, masterKeyId: 'test-key' });
    const alteredBytes = Buffer.from(encrypted.bytes);
    alteredBytes[alteredBytes.length - 2] ^= 1;
    expect(() => decryptRecord({ bytes: alteredBytes, expectedHash: encrypted.envelopeHash, masterKey, expectedRecordId: 'record-0001', expectedVersion: 1 })).toThrow(/hash/i);

    const envelope = JSON.parse(encrypted.bytes.toString('utf8'));
    envelope.authTag = randomBytes(16).toString('base64');
    const tampered = Buffer.from(canonicalJson(envelope));
    expect(() => decryptRecord({ bytes: tampered, expectedHash: sha256Buffer(tampered), masterKey, expectedRecordId: 'record-0001', expectedVersion: 1 })).toThrow(/integrity/i);
  });
});
