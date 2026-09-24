import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { PDFDocument } from 'pdf-lib';
import { runToolbox } from '../src/desktop/toolbox';

test('picture and PDF tools create separate usable outputs without changing the source', async (t) => {
  const root = await fs.mkdtemp(path.join(process.cwd(), 'relay-toolbox-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const input = path.join(root, 'photo.png');
  const canvas = createCanvas(1000, 600);
  const context = canvas.getContext('2d');
  context.fillStyle = '#1f8844';
  context.fillRect(0, 0, 1000, 600);
  await fs.writeFile(input, canvas.toBuffer('image/png'));
  const original = await fs.readFile(input);
  const outputRoot = path.join(root, 'results');
  const signal = new AbortController().signal;
  const progress: string[] = [];
  const resized = await runToolbox({ id: 'image-resize', paths: [input], width: 400 }, outputRoot, signal, (value) => progress.push(value.label));
  assert.equal(resized.outputs.length, 1);
  assert.deepEqual(await fs.readFile(input), original);
  const picture = await loadImage(resized.outputs[0].path);
  assert.equal(picture.width, 400);
  assert.equal(picture.height, 240);
  assert.equal(progress.length, 1);
  const again = await runToolbox({ id: 'image-resize', paths: [input], width: 400 }, outputRoot, signal, () => {});
  assert.notEqual(resized.outputs[0].path, again.outputs[0].path);

  const made = await runToolbox({ id: 'pdf-from-images', paths: [input, input] }, outputRoot, signal, () => {});
  assert.equal(made.outputs.length, 1);
  const firstPdf = await PDFDocument.load(await fs.readFile(made.outputs[0].path));
  assert.equal(firstPdf.getPageCount(), 2);
  const extracted = await runToolbox({ id: 'pdf-extract', paths: [made.outputs[0].path], pages: '2' }, outputRoot, signal, () => {});
  assert.equal(extracted.outputs.length, 1);
  const onePage = await PDFDocument.load(await fs.readFile(extracted.outputs[0].path));
  assert.equal(onePage.getPageCount(), 1);
  const merged = await runToolbox({ id: 'pdf-merge', paths: [made.outputs[0].path, extracted.outputs[0].path] }, outputRoot, signal, () => {});
  const threePages = await PDFDocument.load(await fs.readFile(merged.outputs[0].path));
  assert.equal(threePages.getPageCount(), 3);
});

test('text cleaning is available without files or a model', async () => {
  const result = await runToolbox({ id: 'text-clean', paths: [], text: 'Hello   world\nfrom Relay\n\nSecond  paragraph' }, process.cwd(), new AbortController().signal, () => {});
  assert.equal(result.text, 'Hello world from Relay\n\nSecond paragraph');
});
