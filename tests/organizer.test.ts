import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { scanFiles, buildPlan, applyPlan, undoPlan } from '../src/desktop/organizer';
import { Store } from '../src/desktop/database';
import { fileCategories, type PlanOptions } from '../src/shared/organizer';
import { createPersonalTemp } from './support/personal-temp';

const signal = () => new AbortController().signal;
const noop = () => {};
async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const base = await createPersonalTemp('organizer-');
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const root = path.join(base, 'personal');
  const destination = path.join(base, 'organized');
  await fs.mkdir(root);
  await fs.mkdir(destination);
  const write = async (relative: string, text = relative) => {
    const file = path.join(root, relative);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, text);
    return file;
  };
  const scan = (exclude: string[] = []) =>
    scanFiles({ root, recursive: true, exclude }, signal(), noop);
  const options: PlanOptions = {
    template: 'drive',
    destination,
    operation: 'copy',
    preserveStructure: true,
    categories: fileCategories,
    pattern: '{{number}}-{{stem}}{{ext}}',
    exclude: [],
  };
  return { base, root, destination, write, scan, options };
}
test('scan preserves project trees, exclusions, dot files, hard links and directory junctions', async (t) => {
  const f = await fixture(t);
  await f.write('keep/report.pdf');
  await f.write('project/package.json', '{}');
  await f.write('project/important.txt');
  await f.write('album/.relay-preserve');
  await f.write('album/photo.jpg');
  await f.write('AppData/hidden.txt');
  await f.write('.secret');
  await f.write('excluded/skip.txt');
  const original = await f.write('linked.txt');
  await fs.link(original, path.join(f.root, 'other.txt'));
  await fs.symlink(
    f.destination,
    path.join(f.root, 'junction'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  const scan = await f.scan([path.join(f.root, 'excluded')]);
  assert.deepEqual(
    scan.files.map((file) => file.relative),
    [path.join('keep', 'report.pdf')],
  );
  assert.ok(scan.skipped >= 7);
  assert.equal(scan.status, 'complete');
});
test('cancelled scans cannot produce partial organization plans', async (t) => {
  const f = await fixture(t);
  await f.write('a.txt');
  const controller = new AbortController();
  controller.abort();
  const scan = await scanFiles(
    { root: f.root, recursive: true, exclude: [] },
    controller.signal,
    noop,
  );
  assert.equal(scan.status, 'cancelled');
  await assert.rejects(buildPlan(scan, f.options, signal()), /complete scan/);
});
test('drive planning preserves structure, excludes its output and never mutates files', async (t) => {
  const f = await fixture(t);
  await f.write('trips/beach.jpg');
  await f.write('output/existing.pdf');
  const plan = await buildPlan(
    await f.scan(),
    { ...f.options, destination: path.join(f.root, 'output') },
    signal(),
  );
  assert.equal(plan.items.length, 1);
  assert.equal(
    plan.items[0].destination,
    path.join(f.root, 'output', 'Photos', 'trips', 'beach.jpg'),
  );
  assert.equal(await fs.readFile(plan.items[0].source, 'utf8'), 'trips/beach.jpg');
  await assert.rejects(fs.stat(plan.items[0].destination));
  await assert.rejects(
    buildPlan(await f.scan(), { ...f.options, destination: f.root }, signal()),
    /separate output/,
  );
});
test('downloads uses modification month and rename uses stable sequence variables', async (t) => {
  const f = await fixture(t);
  const file = await f.write('invoice.pdf');
  await fs.utimes(file, new Date('2024-02-12T12:00:00Z'), new Date('2024-02-12T12:00:00Z'));
  const scan = await f.scan();
  const downloads = await buildPlan(scan, { ...f.options, template: 'downloads' }, signal());
  assert.equal(
    downloads.items[0].destination,
    path.join(f.destination, 'Documents', '2024-02', 'invoice.pdf'),
  );
  const rename = await buildPlan(
    scan,
    { ...f.options, template: 'rename', pattern: '{{date}}-{{number}}-{{stem}}{{ext}}' },
    signal(),
  );
  assert.equal(rename.items[0].destination, path.join(f.root, '2024-02-12-0001-invoice.pdf'));
  assert.equal(rename.options.operation, 'move');
  await assert.rejects(
    buildPlan(scan, { ...f.options, template: 'rename', pattern: '../escape.txt' }, signal()),
    /unsafe/,
  );
  await assert.rejects(
    buildPlan(scan, { ...f.options, template: 'rename', pattern: '{{invalid}}' }, signal()),
    /Unknown/,
  );
});
test('existing and duplicate destinations are deselected with a reason', async (t) => {
  const f = await fixture(t);
  await f.write('one/a.txt');
  await f.write('two/a.txt');
  await f.write('b.txt');
  await fs.mkdir(path.join(f.destination, 'Documents'));
  await fs.writeFile(path.join(f.destination, 'Documents', 'b.txt'), 'existing');
  const plan = await buildPlan(
    await f.scan(),
    { ...f.options, preserveStructure: false },
    signal(),
  );
  assert.equal(plan.items.length, 3);
  assert.ok(plan.items.every((i) => i.issue && !i.selected));
  await assert.rejects(applyPlan(plan, signal(), noop, noop), /Select at least one/);
});
test('preflight detects changes anywhere in the selection before copying anything', async (t) => {
  const f = await fixture(t);
  await f.write('a.txt');
  const changed = await f.write('z.txt');
  const plan = await buildPlan(await f.scan(), f.options, signal());
  await fs.writeFile(changed, 'new different contents');
  await applyPlan(plan, signal(), noop, noop);
  assert.equal(plan.status, 'failed');
  assert.match(plan.error!, /Source changed/);
  assert.deepEqual(await fs.readdir(f.destination), []);
});
test('destination appearing after review is retained and stops the whole batch', async (t) => {
  const f = await fixture(t);
  await f.write('a.txt');
  const plan = await buildPlan(await f.scan(), f.options, signal());
  await fs.mkdir(path.dirname(plan.items[0].destination));
  await fs.writeFile(plan.items[0].destination, 'do not overwrite');
  await applyPlan(plan, signal(), noop, noop);
  assert.equal(plan.status, 'failed');
  assert.equal(await fs.readFile(plan.items[0].destination, 'utf8'), 'do not overwrite');
});
test('selected files move, large files work, and persisted batch undo restores originals', async (t) => {
  const f = await fixture(t);
  const first = await f.write('a.txt');
  await f.write('skip.txt');
  const large = await f.write('large.mp4');
  await fs.truncate(large, 26 * 1024 * 1024);
  const plan = await buildPlan(await f.scan(), { ...f.options, operation: 'move' }, signal());
  plan.items.find((i) => i.source.endsWith('skip.txt'))!.selected = false;
  const dbPath = path.join(f.base, 'history.sqlite');
  let store = new Store(dbPath);
  store.putOrganizationPlan(plan, undefined, true);
  await applyPlan(plan, signal(), (p, item) => store.putOrganizationPlan(p, item), noop);
  assert.equal(plan.status, 'complete');
  await assert.rejects(fs.stat(first));
  assert.equal(await fs.readFile(path.join(f.root, 'skip.txt'), 'utf8'), 'skip.txt');
  store.close();
  store = new Store(dbPath);
  try {
    const loaded = store.organizationPlan(plan.id);
    assert.equal(loaded.items.filter((i) => i.state === 'done').length, 2);
    await undoPlan(loaded, signal(), (p, item) => store.putOrganizationPlan(p, item), noop);
    assert.equal(loaded.status, 'undone');
    assert.equal(await fs.readFile(first, 'utf8'), 'a.txt');
    assert.equal((await fs.stat(large)).size, 26 * 1024 * 1024);
    assert.equal(store.organizationPlan(plan.id).status, 'undone');
  } finally {
    store.close();
  }
});
test('cancellation finishes the current operation and allows undo of completed copies', async (t) => {
  const f = await fixture(t);
  await f.write('a.txt');
  await f.write('b.txt');
  const plan = await buildPlan(await f.scan(), f.options, signal());
  const controller = new AbortController();
  await applyPlan(
    plan,
    controller.signal,
    (_p, item) => {
      if (item?.state === 'done') controller.abort(new Error('Cancelled'));
    },
    noop,
  );
  assert.equal(plan.status, 'cancelled');
  assert.equal(plan.items.filter((i) => i.state === 'done').length, 1);
  await undoPlan(plan, signal(), noop, noop);
  assert.equal(plan.status, 'undone');
  assert.equal(await fs.readFile(plan.items[0].source, 'utf8'), 'a.txt');
});
test('undo refuses edited destinations and occupied original paths', async (t) => {
  const f = await fixture(t);
  await f.write('a.txt');
  const plan = await buildPlan(await f.scan(), { ...f.options, operation: 'move' }, signal());
  await applyPlan(plan, signal(), noop, noop);
  await fs.writeFile(plan.items[0].source, 'new occupant');
  await undoPlan(plan, signal(), noop, noop);
  assert.equal(plan.status, 'failed');
  assert.match(plan.error!, /occupied/);
  assert.equal(await fs.readFile(plan.items[0].destination, 'utf8'), 'a.txt');
  await fs.writeFile(plan.items[0].destination, 'edited output');
  await undoPlan(plan, signal(), noop, noop);
  assert.match(plan.error!, /File changed/);
  assert.equal(await fs.readFile(plan.items[0].source, 'utf8'), 'new occupant');
});
test('restart marks interrupted batches and refuses uncertain file ownership', async (t) => {
  const f = await fixture(t);
  await f.write('a.txt');
  const plan = await buildPlan(await f.scan(), f.options, signal());
  plan.status = 'running';
  plan.items[0].state = 'copying';
  const file = path.join(f.base, 'journal.sqlite');
  let store = new Store(file);
  store.putOrganizationPlan(plan, undefined, true);
  store.close();
  store = new Store(file);
  try {
    const loaded = store.organizationPlan(plan.id);
    assert.equal(loaded.status, 'interrupted');
    await assert.rejects(undoPlan(loaded, signal(), noop, noop), /manual inspection/);
  } finally {
    store.close();
  }
});
test('an output junction introduced after review is refused without writes', async (t) => {
  const f = await fixture(t);
  await f.write('a.txt');
  const plan = await buildPlan(await f.scan(), f.options, signal());
  const elsewhere = path.join(f.base, 'elsewhere');
  await fs.mkdir(elsewhere);
  await fs.symlink(
    elsewhere,
    path.join(f.destination, 'Documents'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  await applyPlan(plan, signal(), noop, noop);
  assert.equal(plan.status, 'failed');
  assert.match(plan.error!, /Linked path/);
  assert.deepEqual(await fs.readdir(elsewhere), []);
});
