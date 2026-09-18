import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import sensible from '@fastify/sensible';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, scrypt as nodeScrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { validateWorkflow } from '../desktop/validation';
import type { Run, Workflow } from '../shared/types';

const scrypt = promisify(nodeScrypt);
type User = { id: string; email: string; createdAt: string };
type AuthBody = { email?: unknown; password?: unknown };
type JwtUser = { sub: string; email: string };
type ServerOptions = { dbPath: string; jwtSecret: string; corsOrigin?: string };
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const now = () => new Date().toISOString();
const cleanEmail = (value: unknown) => {
  if (typeof value !== 'string' || value.length > 254 || !emailPattern.test(value.trim()))
    throw new Error('Enter a valid email address.');
  return value.trim().toLowerCase();
};
const password = (value: unknown) => {
  if (typeof value !== 'string' || value.length < 8 || value.length > 200)
    throw new Error('Password must be 8–200 characters.');
  return value;
};
async function hashPassword(value: string) {
  const salt = randomBytes(16);
  const derived = (await scrypt(value, salt, 64)) as Buffer;
  return `${salt.toString('base64url')}.${derived.toString('base64url')}`;
}
async function verifyPassword(value: string, stored: string) {
  const [salt, encoded] = stored.split('.');
  if (!salt || !encoded) return false;
  const expected = Buffer.from(encoded, 'base64url');
  const actual = (await scrypt(value, Buffer.from(salt, 'base64url'), expected.length)) as Buffer;
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
function userFromRow(row: any): User {
  return { id: String(row.id), email: String(row.email), createdAt: String(row.created_at) };
}
function openDb(file: string) {
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA journal_mode=WAL;
    PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, owner_id TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS workspace_members (workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, role TEXT NOT NULL CHECK(role IN ('owner','editor','viewer')), PRIMARY KEY(workspace_id,user_id));
    CREATE TABLE IF NOT EXISTS workflows (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, name TEXT NOT NULL, body TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS workflow_shares (token TEXT PRIMARY KEY, workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE, created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, expires_at TEXT);
    CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id), status TEXT NOT NULL, mode TEXT NOT NULL, source_name TEXT NOT NULL, summary TEXT NOT NULL, error TEXT, started_at TEXT NOT NULL, finished_at TEXT);
    CREATE INDEX IF NOT EXISTS runs_workspace_started ON runs(workspace_id, started_at DESC);`);
  return db;
}
function bodyObject(request: FastifyRequest) {
  if (!request.body || typeof request.body !== 'object' || Array.isArray(request.body))
    throw new Error('Request body must be an object.');
  return request.body as Record<string, unknown>;
}
export async function createServer(options: ServerOptions): Promise<FastifyInstance> {
  const db = openDb(options.dbPath);
  const app = Fastify({ logger: false, bodyLimit: 1_500_000 });
  await app.register(cors, { origin: options.corsOrigin || false, credentials: true });
  await app.register(sensible);
  await app.register(jwt, { secret: options.jwtSecret, sign: { expiresIn: '14d' } });
  app.decorate('requireAuth', async function (request: FastifyRequest) {
    try {
      await request.jwtVerify();
    } catch {
      throw app.httpErrors.unauthorized('Sign in to continue.');
    }
  });
  const auth = async (request: FastifyRequest) => app.requireAuth(request);
  const currentUser = (request: FastifyRequest) => request.user as JwtUser;
  function issue(user: User) {
    return app.jwt.sign({ sub: user.id, email: user.email });
  }
  function workspaceFor(userId: string, workspaceId: string) {
    return db
      .prepare(
        'SELECT w.id,w.name,w.owner_id,m.role FROM workspaces w JOIN workspace_members m ON m.workspace_id=w.id WHERE w.id=? AND m.user_id=?',
      )
      .get(workspaceId, userId) as
      { id: string; name: string; owner_id: string; role: string } | undefined;
  }
  function workflowFor(userId: string, workspaceId: string, workflowId: string) {
    const row = db
      .prepare(
        'SELECT f.* FROM workflows f JOIN workspace_members m ON m.workspace_id=f.workspace_id WHERE f.id=? AND f.workspace_id=? AND m.user_id=?',
      )
      .get(workflowId, workspaceId, userId) as any;
    if (!row) throw app.httpErrors.notFound('Workflow not found.');
    return row;
  }
  function requireWorkspace(request: FastifyRequest, workspaceId: string, write = false) {
    const member = workspaceFor(currentUser(request).sub, workspaceId);
    if (!member || (write && member.role === 'viewer'))
      throw app.httpErrors.forbidden('You do not have access to this workspace.');
    return member;
  }
  app.get('/health', async () => ({ ok: true, service: 'relay-studio-api', time: now() }));
  app.post('/api/auth/register', async (request, reply) => {
    const input = bodyObject(request) as AuthBody;
    let email: string, pass: string;
    try {
      email = cleanEmail(input.email);
      pass = password(input.password);
    } catch (error) {
      throw app.httpErrors.badRequest((error as Error).message);
    }
    if (db.prepare('SELECT id FROM users WHERE email=?').get(email))
      throw app.httpErrors.conflict('An account with this email already exists.');
    const id = randomUUID(),
      created = now();
    db.prepare('INSERT INTO users(id,email,password_hash,created_at) VALUES(?,?,?,?)').run(
      id,
      email,
      await hashPassword(pass),
      created,
    );
    const workspaceId = randomUUID();
    db.prepare('INSERT INTO workspaces(id,name,owner_id,created_at) VALUES(?,?,?,?)').run(
      workspaceId,
      'Personal workspace',
      id,
      created,
    );
    db.prepare('INSERT INTO workspace_members(workspace_id,user_id,role) VALUES(?,?,?)').run(
      workspaceId,
      id,
      'owner',
    );
    const user = { id, email, createdAt: created };
    return reply
      .code(201)
      .send({
        token: issue(user),
        user,
        workspace: { id: workspaceId, name: 'Personal workspace', role: 'owner' },
      });
  });
  app.post('/api/auth/login', async (request, reply) => {
    const input = bodyObject(request) as AuthBody;
    let email: string, pass: string;
    try {
      email = cleanEmail(input.email);
      pass = password(input.password);
    } catch (error) {
      throw app.httpErrors.badRequest((error as Error).message);
    }
    const row = db.prepare('SELECT * FROM users WHERE email=?').get(email) as any;
    if (!row || !(await verifyPassword(pass, String(row.password_hash))))
      throw app.httpErrors.unauthorized('Email or password is incorrect.');
    const user = userFromRow(row),
      workspace = db
        .prepare(
          'SELECT w.id,w.name,m.role FROM workspaces w JOIN workspace_members m ON m.workspace_id=w.id WHERE m.user_id=? ORDER BY w.created_at LIMIT 1',
        )
        .get(user.id) as any;
    return { token: issue(user), user, workspace };
  });
  app.get('/api/me', { preHandler: auth }, async (request) => {
    const row = db.prepare('SELECT * FROM users WHERE id=?').get(currentUser(request).sub) as any;
    if (!row) throw app.httpErrors.unauthorized();
    return { user: userFromRow(row) };
  });
  app.get('/api/workspaces', { preHandler: auth }, async (request) =>
    db
      .prepare(
        'SELECT w.id,w.name,w.created_at,m.role FROM workspaces w JOIN workspace_members m ON m.workspace_id=w.id WHERE m.user_id=? ORDER BY w.created_at',
      )
      .all(currentUser(request).sub),
  );
  app.get('/api/workspaces/:workspaceId/workflows', { preHandler: auth }, async (request) => {
    const { workspaceId } = request.params as { workspaceId: string };
    requireWorkspace(request, workspaceId);
    return db
      .prepare(
        'SELECT id,name,version,created_at,updated_at,body FROM workflows WHERE workspace_id=? ORDER BY updated_at DESC',
      )
      .all(workspaceId)
      .map((row: any) => ({ ...row, workflow: JSON.parse(row.body), body: undefined }));
  });
  app.post('/api/workspaces/:workspaceId/workflows', { preHandler: auth }, async (request) => {
    const { workspaceId } = request.params as { workspaceId: string };
    requireWorkspace(request, workspaceId, true);
    let workflow: Workflow;
    try {
      workflow = validateWorkflow(bodyObject(request).workflow ?? bodyObject(request));
    } catch (error) {
      throw app.httpErrors.badRequest((error as Error).message);
    }
    const existing = db
      .prepare('SELECT id,version,created_at FROM workflows WHERE id=? AND workspace_id=?')
      .get(workflow.id, workspaceId) as any;
    const timestamp = now(),
      version = existing ? Number(existing.version) + 1 : 1;
    db.prepare(
      `INSERT INTO workflows(id,workspace_id,name,body,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,body=excluded.body,version=excluded.version,updated_at=excluded.updated_at`,
    ).run(
      workflow.id,
      workspaceId,
      workflow.name,
      JSON.stringify(workflow),
      version,
      existing?.created_at || timestamp,
      timestamp,
    );
    return { workflow, version, updatedAt: timestamp };
  });
  app.delete(
    '/api/workspaces/:workspaceId/workflows/:workflowId',
    { preHandler: auth },
    async (request) => {
      const { workspaceId, workflowId } = request.params as {
        workspaceId: string;
        workflowId: string;
      };
      requireWorkspace(request, workspaceId, true);
      workflowFor(currentUser(request).sub, workspaceId, workflowId);
      db.prepare('DELETE FROM workflows WHERE id=?').run(workflowId);
      return { deleted: true };
    },
  );
  app.post(
    '/api/workspaces/:workspaceId/workflows/:workflowId/share',
    { preHandler: auth },
    async (request) => {
      const { workspaceId, workflowId } = request.params as {
        workspaceId: string;
        workflowId: string;
      };
      requireWorkspace(request, workspaceId);
      workflowFor(currentUser(request).sub, workspaceId, workflowId);
      const token = randomBytes(24).toString('base64url');
      db.prepare(
        'INSERT INTO workflow_shares(token,workflow_id,created_by,created_at) VALUES(?,?,?,?)',
      ).run(token, workflowId, currentUser(request).sub, now());
      return { token, url: `/api/shared/${token}` };
    },
  );
  app.get('/api/shared/:token', async (request) => {
    const { token } = request.params as { token: string };
    const row = db
      .prepare(
        'SELECT f.body,f.name,s.expires_at FROM workflow_shares s JOIN workflows f ON f.id=s.workflow_id WHERE s.token=?',
      )
      .get(token) as any;
    if (!row || (row.expires_at && Date.parse(row.expires_at) <= Date.now()))
      throw app.httpErrors.notFound('Share link not found or expired.');
    return { name: row.name, workflow: JSON.parse(row.body), readOnly: true };
  });
  app.post('/api/workspaces/:workspaceId/runs', { preHandler: auth }, async (request) => {
    const { workspaceId } = request.params as { workspaceId: string };
    requireWorkspace(request, workspaceId, true);
    const input = bodyObject(request),
      workflowId = input.workflowId;
    if (typeof workflowId !== 'string') throw app.httpErrors.badRequest('workflowId is required.');
    workflowFor(currentUser(request).sub, workspaceId, workflowId);
    const status = input.status,
      mode = input.mode;
    if (
      !['success', 'failed', 'cancelled', 'interrupted'].includes(String(status)) ||
      !['local', 'cloud', 'hybrid'].includes(String(mode))
    )
      throw app.httpErrors.badRequest('Invalid run status or mode.');
    const sourceName =
      typeof input.sourceName === 'string' ? input.sourceName.slice(0, 260) : 'Local file';
    const summary = typeof input.summary === 'string' ? input.summary.slice(0, 10000) : '';
    const id =
        typeof input.id === 'string' && /^[\w-]{1,100}$/.test(input.id) ? input.id : randomUUID(),
      startedAt = typeof input.startedAt === 'string' ? input.startedAt : now(),
      finishedAt = typeof input.finishedAt === 'string' ? input.finishedAt : now(),
      error = typeof input.error === 'string' ? input.error.slice(0, 2000) : null;
    db.prepare(
      'INSERT INTO runs(id,workflow_id,workspace_id,user_id,status,mode,source_name,summary,error,started_at,finished_at) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,summary=excluded.summary,error=excluded.error,finished_at=excluded.finished_at',
    ).run(
      id,
      workflowId,
      workspaceId,
      currentUser(request).sub,
      String(status),
      String(mode),
      sourceName,
      summary,
      error,
      startedAt,
      finishedAt,
    );
    return { id, status, mode, sourceName, summary, error, startedAt, finishedAt };
  });
  app.get('/api/workspaces/:workspaceId/runs', { preHandler: auth }, async (request) => {
    const { workspaceId } = request.params as { workspaceId: string };
    requireWorkspace(request, workspaceId);
    return db
      .prepare(
        'SELECT id,workflow_id,status,mode,source_name,summary,error,started_at,finished_at FROM runs WHERE workspace_id=? ORDER BY started_at DESC LIMIT 100',
      )
      .all(workspaceId);
  });
  app.addHook('onClose', async () => db.close());
  return app;
}
