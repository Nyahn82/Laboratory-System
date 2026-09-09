import { networkInterfaces } from 'node:os';

// Native development serves the same app through localhost and this computer's LAN address.
export function browserOrigins(configured, nodeEnv, interfaces = networkInterfaces()) {
  const origins = new Set(configured);
  if (nodeEnv !== 'development') return [...origins];
  const hosts = new Set(['localhost', '127.0.0.1', '[::1]']);
  for (const info of Object.values(interfaces).flat()) {
    if (info?.family === 'IPv4' && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(info.address)) hosts.add(info.address);
  }
  for (const origin of configured) {
    let url;
    try { url = new URL(origin); } catch { continue; }
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) continue;
    if (!['http:', 'https:'].includes(url.protocol)) continue;
    for (const hostname of hosts) {
      const alias = new URL(url.origin);
      alias.hostname = hostname;
      origins.add(alias.origin);
    }
  }
  return [...origins];
}
