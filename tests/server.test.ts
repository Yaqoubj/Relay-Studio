import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../src/server/app';
import { templates } from '../src/shared/catalog';
test('API supports accounts, workspace workflow sync, sharing, and run history', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'relay-api-'));
  const app = await createServer({
    dbPath: path.join(dir, 'api.sqlite'),
    jwtSecret: 'test-secret-that-is-long-enough-123456',
  });
  await app.ready();
  t.after(async () => {
    await app.close();
    await fs.rm(dir, { recursive: true, force: true });
  });
  assert.deepEqual((await app.inject({ method: 'GET', url: '/health' })).json().ok, true);
  const email = `test-${Date.now()}@example.com`;
  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { email, password: 'correct horse battery staple' },
  });
  assert.equal(registered.statusCode, 201);
  const account = registered.json();
  assert.ok(account.token);
  assert.ok(account.workspace.id);
  const auth = { authorization: `Bearer ${account.token}` };
  const workflow = templates()[0];
  const saved = await app.inject({
    method: 'POST',
    url: `/api/workspaces/${account.workspace.id}/workflows`,
    headers: auth,
    payload: { workflow },
  });
  assert.equal(saved.statusCode, 200);
  assert.equal(saved.json().version, 1);
  const listed = await app.inject({
    method: 'GET',
    url: `/api/workspaces/${account.workspace.id}/workflows`,
    headers: auth,
  });
  assert.equal(listed.json().length, 1);
  assert.equal(listed.json()[0].workflow.name, workflow.name);
  const shared = await app.inject({
    method: 'POST',
    url: `/api/workspaces/${account.workspace.id}/workflows/${workflow.id}/share`,
    headers: auth,
  });
  assert.equal(shared.statusCode, 200);
  const publicRecipe = await app.inject({ method: 'GET', url: shared.json().url });
  assert.equal(publicRecipe.statusCode, 200);
  assert.equal(publicRecipe.json().readOnly, true);
  const run = await app.inject({
    method: 'POST',
    url: `/api/workspaces/${account.workspace.id}/runs`,
    headers: auth,
    payload: {
      workflowId: workflow.id,
      status: 'success',
      mode: 'local',
      sourceName: 'invoice.pdf',
      summary: '5 steps completed',
    },
  });
  assert.equal(run.statusCode, 200);
  const history = await app.inject({
    method: 'GET',
    url: `/api/workspaces/${account.workspace.id}/runs`,
    headers: auth,
  });
  assert.equal(history.json()[0].source_name, 'invoice.pdf');
});
test('API rejects invalid authentication, weak passwords, invalid workflows, and unauthorized access', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'relay-api-'));
  const app = await createServer({
    dbPath: path.join(dir, 'api.sqlite'),
    jwtSecret: 'test-secret-that-is-long-enough-123456',
  });
  await app.ready();
  t.after(async () => {
    await app.close();
    await fs.rm(dir, { recursive: true, force: true });
  });
  assert.equal((await app.inject({ method: 'GET', url: '/api/workspaces' })).statusCode, 401);
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: { email: 'a@example.com', password: 'short' },
      })
    ).statusCode,
    400,
  );
  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { email: 'a@example.com', password: 'password-long-enough' },
  });
  const auth = { authorization: `Bearer ${registered.json().token}` },
    workspace = registered.json().workspace.id;
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: `/api/workspaces/${workspace}/workflows`,
        headers: auth,
        payload: { workflow: { id: 'bad', name: '', nodes: [], edges: [] } },
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (await app.inject({ method: 'GET', url: '/api/workspaces/not-yours/workflows', headers: auth }))
      .statusCode,
    403,
  );
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: { email: 'a@example.com', password: 'password-long-enough' },
      })
    ).statusCode,
    409,
  );
});
