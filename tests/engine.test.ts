import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execute, undoRun, type Services } from '../src/desktop/engine';
import { validateRunnable, validateWorkflow, safeName } from '../src/desktop/validation';
import { catalog, templates } from '../src/shared/catalog';
import { Store } from '../src/desktop/database';
import { transform, validateEndpoint } from '../src/desktop/ai';
import { createServer } from 'node:http';
import type { Workflow, Kind, Run, AISettings } from '../src/shared/types';
import { createPersonalTemp } from './support/personal-temp';
async function setup(t: { after(fn: () => Promise<void>): void }) {
  const dir = await createPersonalTemp('engine-');
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const source = path.join(dir, 'input.txt'),
    output = path.join(dir, 'output');
  await fs.mkdir(output);
  await fs.writeFile(source, 'A useful document.');
  return { dir, source, output };
}
function workflow(kinds: Kind[], configs: Record<string, string>[] = []): Workflow {
  return {
    id: 'test-flow',
    name: 'Test workflow',
    description: '',
    updatedAt: '',
    nodes: kinds.map((kind, i) => ({
      id: `n${i}`,
      type: 'step',
      position: { x: i * 300, y: 0 },
      data: { kind, label: kind, config: { ...catalog[kind].defaults, ...configs[i] } },
    })),
    edges: kinds
      .slice(1)
      .map((_, i) => ({
        id: `e${i}`,
        source: `n${i}`,
        target: `n${i + 1}`,
        ...(kinds[i] === 'filter' ? { sourceHandle: 'yes' } : {}),
      })),
  };
}
function services(overrides: Partial<Services> = {}): Services {
  return {
    signal: new AbortController().signal,
    update: () => {},
    ai: async () => 'Summary',
    notify: () => {},
    allowFolder: async () => {},
    ...overrides,
  };
}
test('preview plans rename/move without changing files or notifying', async (t) => {
  const { source, output } = await setup(t);
  const w = workflow(
    ['trigger', 'move', 'rename', 'notify'],
    [{}, { folder: output }, { name: 'renamed.txt' }],
  );
  const r = await execute(
    w,
    source,
    true,
    'manual',
    services({ notify: () => assert.fail('Preview notification') }),
  );
  assert.equal(r.status, 'success');
  assert.equal(r.steps.length, 4);
  assert.equal(await fs.readFile(source, 'utf8'), 'A useful document.');
  assert.deepEqual(await fs.readdir(output), []);
});
test('real move + rename can be undone in reverse order', async (t) => {
  const { source, output } = await setup(t);
  const r = await execute(
    workflow(['trigger', 'move', 'rename'], [{}, { folder: output }, { name: 'renamed.txt' }]),
    source,
    false,
    'manual',
    services(),
  );
  assert.equal(r.status, 'success');
  await assert.rejects(fs.stat(source));
  assert.equal(await fs.readFile(path.join(output, 'renamed.txt'), 'utf8'), 'A useful document.');
  await undoRun(r, () => {});
  assert.equal(await fs.readFile(source, 'utf8'), 'A useful document.');
  assert.deepEqual(await fs.readdir(output), []);
  assert.ok(r.undone);
});
test('collisions fail without overwriting the destination or removing source', async (t) => {
  const { source, output } = await setup(t);
  await fs.writeFile(path.join(output, 'input.txt'), 'Keep this');
  const r = await execute(
    workflow(['trigger', 'move'], [{}, { folder: output }]),
    source,
    false,
    'manual',
    services(),
  );
  assert.equal(r.status, 'failed');
  assert.match(r.error!, /already exists/);
  assert.equal(await fs.readFile(path.join(output, 'input.txt'), 'utf8'), 'Keep this');
  assert.ok(await fs.stat(source));
});
test('undo refuses to remove a file edited after the run', async (t) => {
  const { source, output } = await setup(t);
  const r = await execute(
    workflow(['trigger', 'copy'], [{}, { folder: output }]),
    source,
    false,
    'manual',
    services(),
  );
  await fs.writeFile(path.join(output, 'input.txt'), 'Edited');
  await assert.rejects(
    undoRun(r, () => {}),
    /changed/,
  );
  assert.equal(await fs.readFile(path.join(output, 'input.txt'), 'utf8'), 'Edited');
});
test('a false condition follows its No branch only', async (t) => {
  const { source } = await setup(t);
  const w = workflow(['trigger', 'filter', 'notify'], [{}, { field: 'extension', value: '.pdf' }]);
  w.nodes.push({ ...w.nodes[2], id: 'n3', data: { ...w.nodes[2].data, label: 'no-path' } });
  w.edges.push({ id: 'no', source: 'n1', target: 'n3', sourceHandle: 'no' });
  const r = await execute(w, source, false, 'manual', services());
  assert.deepEqual(
    r.steps.map((s) => s.nodeId),
    ['n0', 'n1', 'n3'],
  );
});
test('preview never calls AI and identifies unresolved output', async (t) => {
  const { source, output } = await setup(t);
  const w = workflow(['trigger', 'read', 'ai', 'write'], [{}, {}, {}, { folder: output }]);
  const r = await execute(
    w,
    source,
    true,
    'manual',
    services({ ai: async () => assert.fail('Preview called AI') }),
  );
  assert.equal(r.status, 'success');
  assert.equal(r.steps[2].status, 'skipped');
  assert.equal(r.steps[3].status, 'skipped');
  assert.deepEqual(await fs.readdir(output), []);
});
test('text extraction flows through to an exclusive output file', async (t) => {
  const { source, output } = await setup(t);
  const r = await execute(
    workflow(
      ['trigger', 'read', 'write'],
      [{}, {}, { folder: output, content: '{{text}}', name: '{{stem}}-copy.md' }],
    ),
    source,
    false,
    'manual',
    services(),
  );
  assert.equal(r.status, 'success');
  assert.equal(await fs.readFile(path.join(output, 'input-copy.md'), 'utf8'), 'A useful document.');
});
test('unsafe model-generated filenames cannot escape the destination', async (t) => {
  const { source, output } = await setup(t);
  const r = await execute(
    workflow(
      ['trigger', 'read', 'ai', 'write'],
      [{}, {}, { format: 'json' }, { folder: output, name: '{{ai.name}}', content: '{{text}}' }],
    ),
    source,
    false,
    'manual',
    services({ ai: async () => '{"name":"../escape.txt"}' }),
  );
  assert.equal(r.status, 'failed');
  assert.match(r.error!, /unsafe/);
  assert.deepEqual(await fs.readdir(output), []);
});
test('cancellation stops later steps', async (t) => {
  const { source, output } = await setup(t);
  const controller = new AbortController();
  const r = await execute(
    workflow(['trigger', 'read', 'ai', 'write'], [{}, {}, {}, { folder: output }]),
    source,
    false,
    'manual',
    services({
      signal: controller.signal,
      ai: async () => {
        controller.abort();
        return 'Summary';
      },
    }),
  );
  assert.equal(r.status, 'cancelled');
  assert.deepEqual(await fs.readdir(output), []);
});
test('ungranted destination fails before any file action', async (t) => {
  const { source, output } = await setup(t);
  const r = await execute(
    workflow(['trigger', 'rename', 'move'], [{}, { name: 'new.txt' }, { folder: output }]),
    source,
    false,
    'manual',
    services({
      allowFolder: async () => {
        throw new Error('Not authorized');
      },
    }),
  );
  assert.equal(r.status, 'failed');
  assert.ok(await fs.stat(source));
  assert.equal(r.steps.length, 0);
});
test('graph validation rejects loops, duplicate outputs, merges, and disconnected runnable nodes', () => {
  const w = workflow(['trigger', 'read', 'notify']);
  w.edges.push({ id: 'cycle', source: 'n2', target: 'n0' });
  assert.throws(() => validateWorkflow(w));
  const fork = workflow(['trigger', 'read', 'notify']);
  fork.edges.push({ id: 'fork', source: 'n0', target: 'n2' });
  assert.throws(() => validateWorkflow(fork));
  const detached = workflow(['trigger', 'read']);
  detached.edges = [];
  assert.doesNotThrow(() => validateWorkflow(detached));
  assert.throws(() => validateRunnable(detached), /Connect every/);
});
test('templates validate as drafts and reserve safe filenames', () => {
  templates().forEach((w) => assert.doesNotThrow(() => validateWorkflow(w)));
  for (const name of ['../a', 'CON.txt', 'trailing.', 'folder/file', 'x:y'])
    assert.throws(() => safeName(name));
  assert.equal(safeName('invoice-2026.pdf'), 'invoice-2026.pdf');
});
test('null and omitted output handles cannot bypass duplicate-output validation', () => {
  const w = workflow(['trigger', 'read', 'notify']);
  w.edges = [
    { id: 'a', source: 'n0', target: 'n1' },
    { id: 'b', source: 'n0', target: 'n2', sourceHandle: null },
  ];
  assert.throws(() => validateWorkflow(w), /one next step/);
});
test('real PDF text is extracted and written as Markdown', async (t) => {
  const { dir, output } = await setup(t);
  const source = path.join(dir, 'document.pdf');
  const stream = 'BT /F1 12 Tf 50 100 Td (Relay PDF extraction works) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((n) => String(n).padStart(10, '0') + ' 00000 n ')
    .join('\n')}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  await fs.writeFile(source, pdf);
  const r = await execute(
    workflow(
      ['trigger', 'read', 'write'],
      [{}, {}, { folder: output, name: 'extracted.md', content: '{{text}}' }],
    ),
    source,
    false,
    'manual',
    services(),
  );
  assert.equal(r.status, 'success', r.error || 'PDF extraction failed');
  assert.match(
    await fs.readFile(path.join(output, 'extracted.md'), 'utf8'),
    /Relay PDF extraction works/,
  );
});
test('SQLite persists workflows, preserves history, and marks interrupted runs', async (t) => {
  const { dir } = await setup(t);
  const file = path.join(dir, 'test.sqlite');
  const s = new Store(file);
  const w = workflow(['trigger', 'read']);
  s.save(w);
  const run: Run = {
    id: 'run',
    workflowId: w.id,
    workflowName: w.name,
    workflow: w,
    source: 'input.txt',
    preview: false,
    origin: 'manual',
    status: 'running',
    startedAt: new Date().toISOString(),
    steps: [],
  };
  s.putRun(run);
  s.close();
  const reopened = new Store(file);
  assert.equal(reopened.workflow(w.id).name, w.name);
  assert.equal(reopened.run('run').status, 'interrupted');
  reopened.remove(w.id);
  assert.equal(reopened.runs().length, 1);
  reopened.close();
});
test('AI endpoints enforce local-only Ollama and HTTPS cloud', () => {
  const base: AISettings = {
    provider: 'ollama',
    endpoint: 'http://127.0.0.1:11434',
    model: 'test',
    hasKey: false,
    allowCloud: false,
  };
  assert.doesNotThrow(() => validateEndpoint(base));
  assert.throws(() => validateEndpoint({ ...base, endpoint: 'http://example.com' }));
  assert.throws(() =>
    validateEndpoint({ ...base, provider: 'cloud', endpoint: 'http://example.com' }),
  );
});
test('Ollama adapter accepts valid structured output and rejects missing fields', async (t) => {
  let response = '{"company":"Acme","total":"42"}';
  const server = createServer((req, res) => {
    assert.equal(req.url, '/api/chat');
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ message: { content: response } }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(
    () => new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  );
  const address = server.address() as { port: number };
  const s: AISettings = {
    provider: 'ollama',
    endpoint: `http://127.0.0.1:${address.port}`,
    model: 'test-model',
    hasKey: false,
    allowCloud: false,
  };
  const config = { prompt: 'Extract fields', format: 'json', fields: 'company,total' };
  assert.deepEqual(JSON.parse(await transform(s, '', 'Invoice', config)), {
    company: 'Acme',
    total: '42',
  });
  response = '{"company":"Acme"}';
  await assert.rejects(transform(s, '', 'Invoice', config), /missing required/);
  response = 'not json';
  await assert.rejects(transform(s, '', 'Invoice', config), /valid JSON/);
});
