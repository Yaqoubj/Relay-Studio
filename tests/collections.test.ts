import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import { buildPlan, scanFiles, applyPlan, undoPlan, hashFile } from '../src/desktop/organizer';
import { updateDeliveryManifest, type AnalysisServices } from '../src/desktop/collection-analysis';
import {
  organizerDefaults,
  type OrganizerTemplate,
  type OrganizerPreset,
} from '../src/shared/organizer';
import { MaintenanceQueue } from '../src/desktop/maintenance';
import { extractDocument } from '../src/desktop/documents';

const signal = () => new AbortController().signal;
const noop = () => {};
async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const base = await fs.mkdtemp(path.join(process.cwd(), 'relay-collection-test-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const root = path.join(base, 'files');
  const destination = path.join(base, 'output');
  await fs.mkdir(root);
  await fs.mkdir(destination);
  const write = async (relative: string, data: string | Buffer = relative) => {
    const file = path.join(root, relative);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, data);
    return file;
  };
  const scan = () => scanFiles({ root, recursive: true, exclude: [] }, signal(), noop);
  const options = (template: OrganizerTemplate) => ({
    ...organizerDefaults(template),
    destination,
  });
  return { base, root, destination, write, scan, options };
}
test('storage and archive select only the requested ages and sizes', async (t) => {
  const f = await fixture(t);
  const old = await f.write('old.txt', 'large old text');
  await f.write('recent.txt');
  await fs.utimes(old, new Date('2020-01-01'), new Date('2020-01-01'));
  const scan = await f.scan();
  const storage = await buildPlan(
    scan,
    { ...f.options('storage'), minSizeMB: 0.00001, olderThanDays: 30 },
    signal(),
  );
  assert.deepEqual(
    storage.items.map((i) => i.source),
    [old],
  );
  const archive = await buildPlan(scan, { ...f.options('archive'), olderThanDays: 30 }, signal());
  assert.equal(archive.items[0].destination, path.join(f.destination, 'Archive', 'old.txt'));
});
test('duplicates use content hashes, honor preferred keeper and verify it before applying', async (t) => {
  const f = await fixture(t);
  await f.write('first.txt', 'same bytes');
  const keeper = await f.write('original/copy.txt', 'same bytes');
  await f.write('different.txt', 'other data');
  const plan = await buildPlan(
    await f.scan(),
    { ...f.options('duplicates'), operation: 'move', keepFolder: path.dirname(keeper) },
    signal(),
  );
  assert.equal(plan.items.length, 1);
  assert.equal(plan.items[0].keeper?.path, keeper);
  await fs.writeFile(keeper, 'changed keeper');
  await applyPlan(plan, signal(), noop, noop);
  assert.equal(plan.status, 'failed');
  assert.deepEqual(await fs.readdir(f.destination), []);
  assert.equal(await fs.readFile(plan.items[0].source, 'utf8'), 'same bytes');
});
test('photo metadata and sidecars form one date group; unknown dates are explicit', async (t) => {
  const f = await fixture(t);
  const canvas = createCanvas(8, 8);
  const jpeg = canvas.toBuffer('image/jpeg');
  const tiff = Buffer.alloc(64);
  tiff.write('II', 0);
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(1, 8);
  tiff.writeUInt16LE(0x8769, 10);
  tiff.writeUInt16LE(4, 12);
  tiff.writeUInt32LE(1, 14);
  tiff.writeUInt32LE(26, 18);
  tiff.writeUInt16LE(1, 26);
  tiff.writeUInt16LE(0x9003, 28);
  tiff.writeUInt16LE(2, 30);
  tiff.writeUInt32LE(20, 32);
  tiff.writeUInt32LE(44, 36);
  tiff.write('2024:07:15 12:00:00\0', 44);
  const payload = Buffer.concat([Buffer.from('Exif\0\0'), tiff]);
  const marker = Buffer.from([0xff, 0xe1, 0, 0]);
  marker.writeUInt16BE(payload.length + 2, 2);
  await f.write(
    'Trip.jpg',
    Buffer.concat([jpeg.subarray(0, 2), marker, payload, jpeg.subarray(2)]),
  );
  await f.write('Trip.xmp', '<xmp/>');
  await f.write('Unknown.jpg', jpeg);
  const plan = await buildPlan(await f.scan(), f.options('photos'), signal());
  assert.equal(plan.items.length, 3);
  assert.equal(
    plan.items.find((i) => i.source.endsWith('Trip.xmp'))?.destination,
    path.join(f.destination, 'Photos', '2024-07', 'Trip.xmp'),
  );
  assert.ok(
    plan.items
      .find((i) => i.source.endsWith('Unknown.jpg'))
      ?.destination.includes('Unknown capture date'),
  );
});
test('backup verification skips identical files, flags differences and copies only missing files', async (t) => {
  const f = await fixture(t);
  await f.write('same.txt', 'same');
  await f.write('different.txt', 'source');
  await f.write('missing.txt', 'new');
  await fs.writeFile(path.join(f.destination, 'same.txt'), 'same');
  await fs.writeFile(path.join(f.destination, 'different.txt'), 'backup');
  const plan = await buildPlan(
    await f.scan(),
    { ...f.options('backup'), operation: 'move' },
    signal(),
  );
  assert.equal(plan.items.length, 2);
  assert.match(plan.notes!.join(' '), /1 files match/);
  assert.ok(plan.items.find((i) => i.source.endsWith('different.txt'))?.issue);
  await applyPlan(plan, signal(), noop, noop);
  assert.equal(plan.status, 'complete');
  assert.equal(await fs.readFile(path.join(f.root, 'missing.txt'), 'utf8'), 'new');
  assert.equal(await fs.readFile(path.join(f.destination, 'different.txt'), 'utf8'), 'backup');
});
test('delivery manifest follows selection, content is verified, undo leaves originals', async (t) => {
  const f = await fixture(t);
  await f.write('a.txt');
  await f.write('folder/b.txt');
  const plan = await buildPlan(await f.scan(), f.options('delivery'), signal());
  plan.items.find((i) => i.source.endsWith('b.txt'))!.selected = false;
  updateDeliveryManifest(plan);
  const manifest = plan.items.find((i) => i.action === 'write')!;
  assert.equal(manifest.content, `${await hashFile(path.join(f.root, 'a.txt'))}  a.txt\n`);
  await applyPlan(plan, signal(), noop, noop);
  assert.equal(plan.status, 'complete');
  assert.equal(await fs.readFile(manifest.destination, 'utf8'), manifest.content);
  await undoPlan(plan, signal(), noop, noop);
  assert.equal(plan.status, 'undone');
  assert.equal(await fs.readFile(path.join(f.root, 'a.txt'), 'utf8'), 'a.txt');
});
test('AI filing validates categories and confidence, caches results and does not write during analysis', async (t) => {
  const f = await fixture(t);
  await f.write('a.txt', 'a finance document');
  let calls = 0;
  const cache = new Map<string, string>();
  const services: AnalysisServices = {
    fingerprint: 'local/model',
    cached: (key) => cache.get(key),
    cache: (key, value) => {
      cache.set(key, value);
    },
    ai: async () => {
      calls++;
      return JSON.stringify({
        category: 'Finance',
        title: 'Annual statement',
        confidence: '0.7',
        reason: 'annual income',
      });
    },
  };
  const options = f.options('ai-documents');
  const scan = await f.scan();
  const low = await buildPlan(scan, options, signal(), services);
  assert.equal(low.items[0].selected, false);
  assert.match(low.items[0].issue!, /confidence/);
  const accepted = await buildPlan(scan, { ...options, minConfidence: 0.6 }, signal(), services);
  assert.equal(accepted.items[0].selected, true);
  assert.equal(calls, 1);
  assert.equal(accepted.analysis?.cached, 1);
  assert.deepEqual(await fs.readdir(f.destination), []);
  const invalid = await buildPlan(scan, options, signal(), {
    ...services,
    cached: undefined,
    ai: async () =>
      JSON.stringify({ category: '../outside', title: 'bad', confidence: '1', reason: '' }),
  });
  assert.equal(invalid.items.length, 0);
  assert.match(invalid.notes!.join(' '), /allowed category/);
});
test('all AI artifact templates prepare inspectable output, enforce the budget and undo generated files', async (t) => {
  const f = await fixture(t);
  await f.write('a.txt', 'receipt or transcript');
  await f.write('b.txt', 'second document');
  for (const template of ['ai-receipts', 'ai-meetings', 'ai-research', 'ai-adviser'] as const) {
    const answer =
      template === 'ai-receipts'
        ? {
            merchant: 'Shop',
            date: '2026-09-18',
            currency: 'USD',
            total: '14.50',
            confidence: '0.95',
            reason: 'Total 14.50',
          }
        : { content: '## Notes\nUseful draft.', confidence: '0.95', reason: 'source text' };
    const plan = await buildPlan(
      await f.scan(),
      { ...f.options(template), maxAIRequests: 1, operation: 'move' },
      signal(),
      { fingerprint: 'test', ai: async () => JSON.stringify(answer) },
    );
    assert.equal(plan.analysis?.requests, 1);
    assert.match(plan.notes!.join(' '), /first 1 of 2/);
    assert.equal(plan.items[0].action, 'write');
    assert.ok(plan.items[0].content);
    await applyPlan(plan, signal(), noop, noop);
    assert.equal(plan.status, 'complete');
    assert.equal(await fs.readFile(plan.items[0].source, 'utf8'), 'receipt or transcript');
    await undoPlan(plan, signal(), noop, noop);
    assert.equal(plan.status, 'undone');
  }
});
test('AI related-document filing preserves filenames and screenshot filing uses extracted image text', async (t) => {
  const f = await fixture(t);
  await f.write('notes.txt');
  await f.write('screen.png', 'test image');
  const services: AnalysisServices = {
    fingerprint: 'test',
    extract: async () => 'Project Atlas meeting',
    ai: async () =>
      JSON.stringify({
        category: 'Project Atlas',
        title: 'Meeting',
        confidence: '.9',
        reason: 'Project name in text',
      }),
  };
  const related = await buildPlan(
    await f.scan(),
    { ...f.options('ai-related'), labels: 'Project Atlas', categories: ['Documents'] },
    signal(),
    services,
  );
  assert.equal(
    related.items[0].destination,
    path.join(f.destination, 'Project Atlas', 'notes.txt'),
  );
  const screenshots = await buildPlan(
    await f.scan(),
    { ...f.options('ai-screenshots'), labels: 'Project Atlas' },
    signal(),
    services,
  );
  assert.equal(screenshots.items.length, 1);
  assert.equal(
    screenshots.items[0].destination,
    path.join(f.destination, 'Project Atlas', 'Meeting.png'),
  );
});
test(
  'local OCR reads a real image without downloading models and rejects oversized text',
  { timeout: 45000 },
  async (t) => {
    const f = await fixture(t);
    const canvas = createCanvas(1000, 160);
    const context = canvas.getContext('2d');
    context.fillStyle = 'white';
    context.fillRect(0, 0, 1000, 160);
    context.fillStyle = 'black';
    context.font = '48px Arial';
    context.fillText('Relay Studio invoice total 125', 25, 100);
    const file = await f.write('invoice.png', canvas.toBuffer('image/png'));
    const text = await extractDocument(file, { ocr: true, maxCharacters: 1000 }, signal());
    assert.match(text, /Relay Studio/i);
    assert.match(text, /125/);
    const long = await f.write('long.txt', 'a'.repeat(1001));
    await assert.rejects(
      extractDocument(long, { ocr: false, maxCharacters: 1000 }, signal()),
      /exceeds/,
    );
  },
);
test('maintenance catches up once, serializes work, defers while busy, and never runs AI unattended', async () => {
  const preset: OrganizerPreset = {
    id: 'one',
    name: 'Nightly review',
    scan: { root: 'folder', recursive: true, exclude: [] },
    options: organizerDefaults('drive'),
    everyHours: 24,
    enabled: true,
    nextRun: '2020-01-01T00:00:00Z',
  };
  let stored = [preset];
  let available = false;
  let calls = 0;
  let notifications = 0;
  const queue = new MaintenanceQueue({
    list: () => structuredClone(stored),
    save: (presets) => {
      stored = presets;
    },
    available: () => available,
    prepare: async () => {
      calls++;
      return 'plan';
    },
    notify: () => {
      notifications++;
    },
  });
  const now = Date.now();
  await queue.pulse(now);
  assert.equal(calls, 0);
  available = true;
  await Promise.all([queue.pulse(now), queue.pulse(now)]);
  assert.equal(calls, 1);
  assert.equal(notifications, 1);
  assert.equal(stored[0].lastPlanId, 'plan');
  await queue.pulse(now + 1000);
  assert.equal(calls, 1);
  stored[0].options.template = 'ai-documents';
  await queue.pulse(now + 2 * 86400000);
  assert.equal(calls, 1);
});
test('invalid model responses are not cached and provider failure stops further requests', async (t) => {
  const f = await fixture(t);
  await f.write('a.txt');
  await f.write('b.txt');
  let cached = 0;
  let calls = 0;
  const invalid = await buildPlan(await f.scan(), f.options('ai-documents'), signal(), {
    fingerprint: 'test',
    cache: () => {
      cached++;
    },
    ai: async () => '{"broken":true}',
  });
  assert.equal(cached, 0);
  assert.equal(invalid.items.length, 0);
  const failed = await buildPlan(await f.scan(), f.options('ai-documents'), signal(), {
    fingerprint: 'test',
    ai: async () => {
      calls++;
      throw new Error('Provider unavailable');
    },
  });
  assert.equal(calls, 1);
  assert.match(failed.notes!.join(' '), /Remaining documents were not sent/);
});
test('verified copy and undo preserve modification dates', async (t) => {
  const f = await fixture(t);
  const source = await f.write('old.txt');
  const modified = new Date('2020-02-03T04:05:06Z');
  await fs.utimes(source, modified, modified);
  const plan = await buildPlan(
    await f.scan(),
    { ...f.options('drive'), operation: 'move' },
    signal(),
  );
  await applyPlan(plan, signal(), noop, noop);
  assert.equal((await fs.stat(plan.items[0].destination)).mtimeMs, modified.getTime());
  await undoPlan(plan, signal(), noop, noop);
  assert.equal((await fs.stat(source)).mtimeMs, modified.getTime());
});
test(
  'scanned PDF pages use local OCR instead of returning an empty document',
  { timeout: 45000 },
  async (t) => {
    const f = await fixture(t);
    const canvas = createCanvas(1000, 160);
    const context = canvas.getContext('2d');
    context.fillStyle = 'white';
    context.fillRect(0, 0, 1000, 160);
    context.fillStyle = 'black';
    context.font = '48px Arial';
    context.fillText('Scanned receipt total 125', 25, 100);
    const jpeg = canvas.toBuffer('image/jpeg');
    const drawing = 'q 500 0 0 80 20 20 cm /Scan Do Q';
    const objects = [
      Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
      Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
      Buffer.from(
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 540 120] /Resources << /XObject << /Scan 5 0 R >> >> /Contents 4 0 R >>',
      ),
      Buffer.from(`<< /Length ${drawing.length} >>\nstream\n${drawing}\nendstream`),
      Buffer.concat([
        Buffer.from(
          `<< /Type /XObject /Subtype /Image /Width 1000 /Height 160 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
        ),
        jpeg,
        Buffer.from('\nendstream'),
      ]),
    ];
    const chunks = [Buffer.from('%PDF-1.4\n')];
    const offsets: number[] = [];
    for (const [index, object] of objects.entries()) {
      offsets.push(Buffer.concat(chunks).length);
      chunks.push(Buffer.from(`${index + 1} 0 obj\n`), object, Buffer.from('\nendobj\n'));
    }
    const xref = Buffer.concat(chunks).length;
    chunks.push(
      Buffer.from(
        `xref\n0 6\n0000000000 65535 f \n${offsets.map((offset) => String(offset).padStart(10, '0') + ' 00000 n ').join('\n')}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`,
      ),
    );
    const file = await f.write('scan.pdf', Buffer.concat(chunks));
    await assert.rejects(
      extractDocument(file, { ocr: false, maxCharacters: 1000 }, signal()),
      /Enable local OCR/,
    );
    const text = await extractDocument(file, { ocr: true, maxCharacters: 1000 }, signal());
    assert.match(text, /Scanned receipt/i);
    assert.match(text, /125/);
  },
);
