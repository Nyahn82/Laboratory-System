function write(level, event, fields = {}) {
  const safeFields = {
    requestId: fields.requestId,
    correlationId: fields.correlationId,
    method: fields.method,
    path: fields.path,
    status: fields.status,
    durationMs: fields.durationMs,
    errorName: fields.errorName,
    errorCode: fields.errorCode,
  };

  const entry = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...Object.fromEntries(Object.entries(safeFields).filter(([, value]) => value !== undefined)),
  };
  const output = JSON.stringify(entry);
  if (level === 'error') console.error(output);
  else console.log(output);
}

export const logger = Object.freeze({
  info: (event, fields) => write('info', event, fields),
  error: (event, fields) => write('error', event, fields),
});
