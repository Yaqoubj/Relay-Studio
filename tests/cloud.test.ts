import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server/app';
import { RelayCloudClient } from '../src/desktop/cloud';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { templates } from '../src/shared/catalog';
test('desktop cloud client signs in, syncs workflows, shares, and records a run', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'relay-cloud-'));
  const api = await createServer({
    dbPath: path.join(dir, 'api.sqlite'),
    jwtSecret: 'cloud-client-test-secret-long-enough',
  });
  await api.listen({ port: 0, host: '127.0.0.1' });
  t.after(async () => {
    await api.close();
    await fs.rm(dir, { recursive: true, force: true });
  });
  const address = api.server.address();
  if (!address || typeof address === 'string') throw new Error('No test address');
  const client = new RelayCloudClient(`http://127.0.0.1:${address.port}`);
  const session = await client.register(`cloud-${Date.now()}@example.com`, 'password-long-enough');
  const workflow = templates()[0];
  await client.saveWorkflow(session.workspace.id, workflow);
  assert.equal((await client.workflows(session.workspace.id))[0].workflow.name, workflow.name);
  assert.ok((await client.shareWorkflow(session.workspace.id, workflow.id)).token);
  await client.recordRun(session.workspace.id, {
    id: 'local-run',
    workflowId: workflow.id,
    status: 'success',
    source: 'C:\\Inbox\\file.pdf',
    preview: false,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    error: undefined,
    workflow,
  });
});
test('cloud client rejects unsafe API URLs', () => {
  assert.throws(() => new RelayCloudClient('file:///tmp/relay'));
  assert.throws(() => new RelayCloudClient('https://user:pass@example.com'));
});
