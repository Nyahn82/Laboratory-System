import { describe, expect, it } from 'vitest';
import { browserOrigins } from '../src/browserOrigins.js';
const interfaces = { ethernet: [{ family: 'IPv4', address: '192.168.30.102' }, { family: 'IPv4', address: '203.0.113.1' }] };
describe('native browser origins', () => {
  it('allows only the current computer aliases on configured ports in development', () => {
    const allowed=browserOrigins(['http://localhost:5173'], 'development', interfaces);
    expect(allowed).toEqual(expect.arrayContaining(['http://localhost:5173','http://127.0.0.1:5173','http://[::1]:5173','http://192.168.30.102:5173']));
    for(const origin of ['http://192.168.30.103:5173','http://192.168.30.102:9999','http://203.0.113.1:5173','https://example.com','null']) expect(allowed).not.toContain(origin);
  });
  it.each(['production','test'])('preserves the explicit origin list in %s', nodeEnv => {
    expect(browserOrigins(['http://localhost:5173'],nodeEnv,interfaces)).toEqual(['http://localhost:5173']);
  });
});
