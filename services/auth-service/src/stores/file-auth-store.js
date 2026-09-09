import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { ROLE_DEFINITIONS } from '../constants.js';
import { MemoryAuthStore } from './memory-auth-store.js';

const SCHEMA_VERSION = 1;
const COLLECTIONS = Object.freeze([
  'roles',
  'users',
  'sessions',
  'passwordResetTokens',
  'loginAttempts',
  'auditEvents',
]);

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function validateState(state) {
  if (!state || state.schemaVersion !== SCHEMA_VERSION) {
    throw new Error('Authentication data file has an unsupported schema version.');
  }
  for (const collection of COLLECTIONS) {
    if (!Array.isArray(state[collection])) {
      throw new Error(`Authentication data file is missing the ${collection} collection.`);
    }
  }
  if (!Number.isSafeInteger(state.nextUserNumber) || state.nextUserNumber < 1) {
    throw new Error('Authentication data file has an invalid user sequence.');
  }
  return state;
}

export class FileAuthStore {
  constructor({ filename, clock = () => new Date() }) {
    if (!filename) throw new Error('A filename is required for the file authentication store.');
    this.filename = path.resolve(filename);
    this.clock = clock;
    this.memory = null;
    this.initializePromise = null;
    this.queue = Promise.resolve();
  }

  async initialize() {
    if (!this.initializePromise) {
      this.initializePromise = this.#initialize().catch((error) => {
        this.initializePromise = null;
        throw error;
      });
    }
    await this.initializePromise;
  }

  async #initialize() {
    await mkdir(path.dirname(this.filename), { recursive: true });
    try {
      const state = validateState(JSON.parse(await readFile(this.filename, 'utf8')));
      this.#restore(state);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      this.memory = new MemoryAuthStore({ roles: ROLE_DEFINITIONS, clock: this.clock });
      await this.#write(this.#snapshot());
    }
  }

  #snapshot() {
    return clone({
      schemaVersion: SCHEMA_VERSION,
      roles: this.memory.roles,
      users: this.memory.users,
      sessions: this.memory.sessions,
      passwordResetTokens: this.memory.passwordResetTokens,
      loginAttempts: this.memory.loginAttempts,
      auditEvents: this.memory.auditEvents,
      nextUserNumber: this.memory.nextUserNumber,
    });
  }

  #restore(state) {
    this.memory = new MemoryAuthStore({
      roles: state.roles,
      users: state.users,
      clock: this.clock,
    });
    this.memory.sessions = clone(state.sessions);
    this.memory.passwordResetTokens = clone(state.passwordResetTokens);
    this.memory.loginAttempts = clone(state.loginAttempts);
    this.memory.auditEvents = clone(state.auditEvents);
    this.memory.nextUserNumber = state.nextUserNumber;
  }

  async #write(state) {
    await mkdir(path.dirname(this.filename), { recursive: true });
    const temporary = `${this.filename}.${process.pid}.${randomUUID()}.tmp`;
    let handle;
    try {
      handle = await open(temporary, 'wx', 0o600);
      await handle.writeFile(`${JSON.stringify(state, null, 2)}\n`, 'utf8');
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(temporary, this.filename);
    } finally {
      if (handle) await handle.close().catch(() => {});
      await rm(temporary, { force: true }).catch(() => {});
    }
  }

  async #read(operation) {
    await this.queue;
    await this.initialize();
    return operation(this.memory);
  }

  #mutate(operation) {
    const run = async () => {
      await this.initialize();
      const before = this.#snapshot();
      try {
        const result = await operation(this.memory);
        await this.#write(this.#snapshot());
        return result;
      } catch (error) {
        this.#restore(before);
        throw error;
      }
    };
    const pending = this.queue.then(run, run);
    this.queue = pending.catch(() => {});
    return pending;
  }

  async healthCheck() {
    await this.#read(() => undefined);
    return {
      ok: true,
      driver: 'file',
      provider: 'atomic-json',
      simulated: true,
      filePath: this.filename,
    };
  }

  async close() {
    await this.queue;
  }

  findUserByEmail(email) {
    return this.#read((store) => store.findUserByEmail(email));
  }

  findUserById(id) {
    return this.#read((store) => store.findUserById(id));
  }

  listUsers(query) {
    return this.#read((store) => store.listUsers(query));
  }

  createUser(input) {
    return this.#mutate((store) => store.createUser(input));
  }

  updateUser(id, updates) {
    return this.#mutate((store) => store.updateUser(id, updates));
  }

  setUserStatus(id, status) {
    return this.#mutate((store) => store.setUserStatus(id, status));
  }

  updatePassword(id, passwordHash, options) {
    return this.#mutate((store) => store.updatePassword(id, passwordHash, options));
  }

  listRoles() {
    return this.#read((store) => store.listRoles());
  }

  createSession(session) {
    return this.#mutate((store) => store.createSession(session));
  }

  findSessionByTokenHash(tokenHash) {
    return this.#read((store) => store.findSessionByTokenHash(tokenHash));
  }

  rotateSession(currentSessionId, replacement, rotatedAt) {
    return this.#mutate((store) => store.rotateSession(currentSessionId, replacement, rotatedAt));
  }

  revokeSessionFamily(familyId, reason, revokedAt) {
    return this.#mutate((store) => store.revokeSessionFamily(familyId, reason, revokedAt));
  }

  revokeSessionByTokenHash(tokenHash, reason, revokedAt) {
    return this.#mutate((store) => store.revokeSessionByTokenHash(tokenHash, reason, revokedAt));
  }

  revokeAllUserSessions(userId, reason, revokedAt) {
    return this.#mutate((store) => store.revokeAllUserSessions(userId, reason, revokedAt));
  }

  createPasswordResetToken(resetToken) {
    return this.#mutate((store) => store.createPasswordResetToken(resetToken));
  }

  findPasswordResetTokenByHash(tokenHash) {
    return this.#read((store) => store.findPasswordResetTokenByHash(tokenHash));
  }

  consumePasswordResetToken(input) {
    return this.#mutate((store) => store.consumePasswordResetToken(input));
  }

  recordLoginAttempt(attempt) {
    return this.#mutate((store) => store.recordLoginAttempt(attempt));
  }

  createAuditEvent(event) {
    return this.#mutate((store) => store.createAuditEvent(event));
  }

  listUserAudit(userId, query) {
    return this.#read((store) => store.listUserAudit(userId, query));
  }
}
