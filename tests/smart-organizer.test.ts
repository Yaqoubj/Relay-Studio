import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import { scanFiles, buildPlan, applyPlan, undoPlan } from '../src/desktop/organizer';
import { organizerDefaults } from '../src/shared/organizer';

const signal = () => new AbortController().signal;
const noop = () => {};
async function setup(t: { after(fn: () => Promise<void>): void }) {
  const base = await fs.mkdtemp(path.join(process.cwd(), 'relay-smart-test-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const source = path.join(base, 'Downloads');
  await fs.mkdir(source);
  const write = async (name: string) => {
    const file = path.join(source, name);
    await fs.writeFile(file, name);
    return file;
  };
  const scan = () => scanFiles({ root: source, recursive: true, exclude: [] }, signal(), noop);
  return { source, write, scan };
}

test('general organizer groups mixed files inside the source, keeps subtitles together, and undo removes new folders', async (t) => {
  const f = await setup(t);
  await f.write('Show.Name.S02E03.mkv');
  await f.write('Show.Name.S02E03.srt');
  await f.write('Screenshot_22.png');
  await f.write('Beach trip-001.jpg');
  await f.write('Beach trip-002.jpg');
  await f.write('Beach trip-003.jpg');
  await f.write('invoice.pdf');
  await f.write('mystery.xyz');
  const options = organizerDefaults('smart');
  const plan = await buildPlan(await f.scan(), options, signal());
  const video = plan.items.find((entry) => entry.source.endsWith('.mkv'))!;
  const subtitle = plan.items.find((entry) => entry.source.endsWith('.srt'))!;
  assert.equal(video.group, 'Videos / Show Name / Season 02');
  assert.equal(path.dirname(video.destination), path.dirname(subtitle.destination));
  assert.ok(
    plan.items.some((entry) => entry.destination.includes(path.join('Pictures', 'Screenshots'))),
  );
  assert.equal(plan.items.filter((entry) => entry.group === 'Pictures / Beach trip').length, 3);
  assert.equal(plan.items.find((entry) => entry.source.endsWith('.xyz'))?.selected, false);
  assert.equal(await fs.readdir(f.source).then((files) => files.length), 8);
  await applyPlan(plan, signal(), noop, noop);
  assert.equal(plan.status, 'complete');
  assert.ok((await fs.stat(video.destination)).isFile());
  const rerun = await buildPlan(await f.scan(), options, signal());
  assert.equal(rerun.items.length, 1);
  assert.equal(rerun.items[0].selected, false);
  await undoPlan(plan, signal(), noop, noop);
  assert.equal(plan.status, 'undone');
  assert.ok((await fs.stat(path.join(f.source, 'Show.Name.S02E03.mkv'))).isFile());
  await assert.rejects(fs.stat(path.join(f.source, 'Videos')));
});

test('general organizer can create a new subfolder and AI only improves supported documents', async (t) => {
  const f = await setup(t);
  await f.write('scan.pdf');
  await f.write('clip.mp4');
  const scan = await f.scan();
  const options = {
    ...organizerDefaults('smart-ai'),
    placement: 'subfolder' as const,
    subfolderName: 'Sorted',
  };
  const plan = await buildPlan(scan, options, signal(), {
    fingerprint: 'test-model',
    extract: async () => 'rental agreement',
    ai: async () =>
      JSON.stringify({
        category: 'Finance',
        title: 'Rental agreement',
        confidence: '0.95',
        reason: 'rental agreement text',
      }),
  });
  assert.ok(
    plan.items.some(
      (entry) =>
        entry.destination ===
        path.join(f.source, 'Sorted', 'Documents', 'Finance', 'scan.pdf'),
    ),
  );
  assert.ok(
    plan.items.some(
      (entry) => entry.destination === path.join(f.source, 'Sorted', 'Videos', 'clip.mp4'),
    ),
  );
  assert.equal(plan.analysis?.requests, 1);
  await applyPlan(plan, signal(), noop, noop);
  assert.equal(plan.status, 'complete');
  await undoPlan(plan, signal(), noop, noop);
  await assert.rejects(fs.stat(path.join(f.source, 'Sorted')));
});

test('an unknown file with an episode-like name is not treated as a video', async (t) => {
  const f = await setup(t);
  await f.write('My.Game.S01E01.xyz');
  const plan = await buildPlan(await f.scan(), organizerDefaults('smart'), signal());
  assert.equal(plan.items.length, 1);
  assert.equal(plan.items[0].selected, false);
  assert.equal(plan.items[0].group, 'Other');
});

test('limited drive scans produce an explicitly partial review and resume remaining folders', async (t) => {
  const f = await setup(t);
  await fs.mkdir(path.join(f.source, 'Later'));
  await fs.writeFile(path.join(f.source, 'Later', 'episode.mp4'), 'video');
  const initial = await f.scan();
  const partial = {
    ...initial,
    status: 'limited' as const,
    files: [],
    pendingFolders: [path.join(f.source, 'Later')],
  };
  const continued = await scanFiles(initial.options!, signal(), noop, partial);
  assert.equal(continued.status, 'complete');
  assert.equal(continued.files.length, 1);
  const review = await buildPlan(
    { ...continued, status: 'limited', pendingFolders: ['another folder'] },
    organizerDefaults('smart'),
    signal(),
  );
  assert.match(review.notes?.join(' ') || '', /Partial scan/);
  assert.equal(review.items.length, 1);
});

test('storage cleanup combines duplicate and age rules without moving the retained copy', async (t) => {
  const f = await setup(t);
  await fs.writeFile(path.join(f.source, 'keep.txt'), 'same');
  await fs.writeFile(path.join(f.source, 'extra.txt'), 'same');
  await fs.writeFile(path.join(f.source, 'old.mp4'), 'unique');
  const destination = path.join(path.dirname(f.source), 'Archive');
  await fs.mkdir(destination);
  const options = {
    ...organizerDefaults('cleanup'),
    destination,
    minSizeMB: 0,
    olderThanDays: 0,
  };
  const plan = await buildPlan(await f.scan(), options, signal());
  assert.equal(plan.items.filter((entry) => entry.group === 'Exact duplicates').length, 1);
  assert.equal(plan.items.filter((entry) => entry.group === 'Large old files').length, 1);
  const retained = plan.items[0].keeper!.path;
  assert.ok(plan.items.every((entry) => entry.source !== retained));
  await applyPlan(plan, signal(), noop, noop);
  assert.equal(plan.status, 'complete');
  assert.ok((await fs.stat(retained)).isFile());
  await undoPlan(plan, signal(), noop, noop);
  assert.equal(plan.status, 'undone');
});

test('share preparation leaves private-looking names out of the selected delivery', async (t) => {
  const f = await setup(t);
  await f.write('report.pdf');
  await f.write('bank-passwords.txt');
  const destination = path.join(path.dirname(f.source), 'Delivery');
  await fs.mkdir(destination);
  const plan = await buildPlan(
    await f.scan(),
    { ...organizerDefaults('delivery'), destination },
    signal(),
  );
  assert.equal(
    plan.items.find((entry) => entry.source.endsWith('bank-passwords.txt'))?.selected,
    false,
  );
  assert.ok(plan.items.some((entry) => entry.group === 'Review private-looking files'));
  assert.ok(
    plan.items
      .find((entry) => entry.destination.endsWith('SHA256SUMS.txt'))
      ?.content?.includes('report.pdf'),
  );
  assert.ok(
    !plan.items
      .find((entry) => entry.destination.endsWith('SHA256SUMS.txt'))
      ?.content?.includes('bank-passwords.txt'),
  );
});

test('combine collections moves source folders into a separate chosen library', async (t) => {
  const f = await setup(t);
  await fs.mkdir(path.join(f.source, 'Old phone'));
  await fs.mkdir(path.join(f.source, 'Camera copy'));
  await fs.writeFile(path.join(f.source, 'Old phone', 'beach.jpg'), 'one');
  await fs.writeFile(path.join(f.source, 'Camera copy', 'mountain.jpg'), 'two');
  const destination = path.join(path.dirname(f.source), 'Library');
  await fs.mkdir(destination);
  const options = { ...organizerDefaults('combine'), destination };
  const plan = await buildPlan(await f.scan(), options, signal());
  assert.equal(plan.items.length, 2);
  assert.ok(
    plan.items.every((entry) => entry.destination.startsWith(path.join(destination, 'Pictures'))),
  );
  await applyPlan(plan, signal(), noop, noop);
  assert.equal(plan.status, 'complete');
  const again = await buildPlan(await f.scan(), options, signal());
  assert.equal(again.items.length, 0);
});

test('local visual similarity groups two matching pictures without treating them as duplicates', async (t) => {
  const f = await setup(t);
  const canvas = createCanvas(90, 80);
  const context = canvas.getContext('2d');
  context.fillStyle = '#4f7c99';
  context.fillRect(0, 0, 90, 80);
  context.fillStyle = '#f4c65b';
  context.fillRect(10, 10, 32, 42);
  const image = canvas.toBuffer('image/png');
  await fs.writeFile(path.join(f.source, 'a.png'), image);
  await fs.writeFile(path.join(f.source, 'b.png'), image);
  const plan = await buildPlan(await f.scan(), organizerDefaults('smart'), signal());
  assert.equal(plan.items.length, 2);
  assert.ok(plan.items.every((entry) => entry.group?.includes('Similar set')));
  assert.ok(plan.items.every((entry) => entry.selected));
});
