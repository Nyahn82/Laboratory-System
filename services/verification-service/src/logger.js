function write(level, event, fields = {}) {
  const safe = {
    timestamp: new Date().toISOString(),
    level,
    event,
    requestId: fields.requestId,
    recordId: fields.recordId,
    version: fields.version,
    status: fields.status,
    errorCode: fields.errorCode,
  };
  const line = JSON.stringify(Object.fromEntries(Object.entries(safe).filter(([, value]) => value !== undefined)));
  if (level === 'error') console.error(line);
  else console.log(line);
}

export const logger = Object.freeze({
  info: (event, fields) => write('info', event, fields),
  error: (event, fields) => write('error', event, fields),
});
