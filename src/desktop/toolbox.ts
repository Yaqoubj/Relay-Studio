import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { PDFDocument } from 'pdf-lib';
import { extractDocument } from './documents';
import { toolboxTools, type ToolboxInput, type ToolboxProgress, type ToolboxResult, type ToolboxToolId } from '../shared/toolbox';

const imageTypes = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tif', '.tiff']);
const documents = new Set(['.pdf', '.docx', '.txt', '.md', '.csv', '.json', '.log', '.html', '.xml', '.yaml', '.yml', ...imageTypes]);

export function validateToolboxInput(input: ToolboxInput) {
  const tool = toolboxTools.find((entry) => entry.id === input?.id);
  if (!tool) throw new Error('Choose a tool from the toolbox.');
  if (!Array.isArray(input.paths) || input.paths.length > 50 || input.paths.some((p) => typeof p !== 'string' || !path.isAbsolute(p)))
    throw new Error('Choose up to 50 files using the file picker.');
  if (tool.accepts === 'text') {
    if (typeof input.text !== 'string' || !input.text.trim() || input.text.length > 500000)
      throw new Error('Paste some text (up to 500,000 characters).');
  } else if (!input.paths.length) throw new Error('Choose at least one file.');
  if (input.width !== undefined && (!Number.isInteger(input.width) || input.width < 200 || input.width > 8000))
    throw new Error('Choose a width from 200 to 8,000 pixels.');
  if (input.format !== undefined && !['jpeg', 'png', 'webp'].includes(input.format))
    throw new Error('Choose JPG, PNG, or WebP.');
  if (input.pages !== undefined && (typeof input.pages !== 'string' || input.pages.length > 100))
    throw new Error('Enter a short page range, such as 1-3,5.');
  for (const file of input.paths) {
    const extension = path.extname(file).toLowerCase();
    if (tool.accepts === 'image' && !imageTypes.has(extension))
      throw new Error(`Unsupported picture: ${path.basename(file)}. Choose JPG, PNG, WebP, BMP, or TIFF.`);
    if (tool.accepts === 'pdf' && extension !== '.pdf')
      throw new Error(`Choose PDF files for ${tool.title}.`);
    if (tool.accepts === 'document' && !documents.has(extension))
      throw new Error(`Cannot read ${path.basename(file)}. Choose a supported document or picture.`);
  }
  if (input.id === 'pdf-extract' && input.paths.length !== 1)
    throw new Error('Choose one PDF to extract pages from.');
  if (input.id === 'pdf-from-images' && input.paths.length > 20)
    throw new Error('Choose up to 20 pictures for one PDF.');
}

function pageIndices(value: string, count: number) {
  const indices: number[] = [];
  for (const part of value.split(',')) {
    const match = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!match) throw new Error('Enter pages like 1-3,5.');
    const from = Number(match[1]);
    const to = Number(match[2] || match[1]);
    if (from < 1 || to < from || to > count || indices.length + to - from + 1 > 500)
      throw new Error(`Choose pages between 1 and ${count}, in ascending ranges.`);
    for (let i = from; i <= to; i++) indices.push(i - 1);
  }
  return indices;
}

function cleanText(value: string) {
  return value.replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.split('\n').map((line) => line.trim().replace(/[ \t]+/g, ' ')).join(' '))
    .filter(Boolean)
    .join('\n\n');
}

async function checkedFile(file: string, limitMB = 40) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > limitMB * 1024 * 1024)
    throw new Error(`${path.basename(file)} must be a regular file no larger than ${limitMB} MB.`);
  return stat.size;
}

async function writeResult(folder: string, base: string, bytes: Uint8Array) {
  await fs.mkdir(folder, { recursive: true });
  for (let index = 0; index < 1000; index++) {
    const extension = path.extname(base);
    const stem = path.basename(base, extension);
    const output = path.join(folder, index ? `${stem}-${index + 1}${extension}` : base);
    try {
      await fs.writeFile(output, bytes, { flag: 'wx' });
      return output;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
  throw new Error('Too many files have the same result name.');
}

async function pictureBuffer(file: string, input: ToolboxInput) {
  await checkedFile(file);
  const image = await loadImage(file);
  const maxWidth = input.id === 'image-resize' ? (input.width || 1600) : input.id === 'image-smaller' ? 1600 : image.width;
  const scale = Math.min(1, maxWidth / image.width);
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  if (width * height > 60_000_000) throw new Error('This picture is too large to process safely.');
  const extension = path.extname(file).toLowerCase();
  const format = input.id === 'image-convert' ? (input.format || 'jpeg')
    : input.id === 'image-smaller' ? 'webp'
      : extension === '.jpg' || extension === '.jpeg' ? 'jpeg' : extension === '.webp' ? 'webp' : 'png';
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');
  if (format === 'jpeg') {
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
  }
  context.drawImage(image, 0, 0, width, height);
  const bytes = format === 'png' ? canvas.toBuffer('image/png')
    : format === 'webp' ? canvas.toBuffer('image/webp', 0.8)
      : canvas.toBuffer('image/jpeg', 0.82);
  return { bytes, format };
}

export async function runToolbox(
  input: ToolboxInput,
  outputRoot: string,
  signal: AbortSignal,
  progress: (value: ToolboxProgress) => void,
): Promise<ToolboxResult> {
  validateToolboxInput(input);
  const result: ToolboxResult = {
    id: randomUUID(), tool: input.id, createdAt: new Date().toISOString(), outputs: [], errors: [], inputBytes: 0,
  };
  if (input.id === 'text-clean') {
    result.text = cleanText(input.text || '');
    progress({ completed: 1, total: 1, label: 'Text cleaned' });
    return result;
  }
  const folder = path.join(outputRoot, input.id);
  const total = input.id === 'pdf-merge' || input.id === 'pdf-from-images' ? input.paths.length : input.paths.length;
  let completed = 0;
  const mark = (file: string) => progress({ completed: ++completed, total, label: path.basename(file) });
  if (input.id === 'pdf-merge' || input.id === 'pdf-from-images') {
    const document = await PDFDocument.create();
    for (const file of input.paths) {
      signal.throwIfAborted();
      result.inputBytes! += await checkedFile(file);
      if (result.inputBytes! > 120 * 1024 * 1024)
        throw new Error('Choose a smaller set: one PDF job is limited to 120 MB of input.');
      if (input.id === 'pdf-merge') {
        const source = await PDFDocument.load(await fs.readFile(file));
        const pages = await document.copyPages(source, source.getPageIndices());
        for (const page of pages) document.addPage(page);
      } else {
        const image = await loadImage(file);
        if (image.width * image.height > 60_000_000) throw new Error(`${path.basename(file)} is too large to add to a PDF.`);
        const pixelScale = Math.min(1, 2000 / Math.max(image.width, image.height));
        const canvas = createCanvas(Math.max(1, Math.round(image.width * pixelScale)), Math.max(1, Math.round(image.height * pixelScale)));
        canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
        const embedded = await document.embedPng(canvas.toBuffer('image/png'));
        const maxEdge = 1000;
        const scale = Math.min(1, maxEdge / Math.max(embedded.width, embedded.height));
        const width = embedded.width * scale, height = embedded.height * scale;
        document.addPage([width, height]).drawImage(embedded, { x: 0, y: 0, width, height });
      }
      mark(file);
    }
    signal.throwIfAborted();
    const output = await writeResult(folder, input.id === 'pdf-merge' ? 'Combined.pdf' : 'Pictures.pdf', await document.save());
    result.outputs.push({ path: output, bytes: (await fs.stat(output)).size });
    return result;
  }
  for (const file of input.paths) {
    signal.throwIfAborted();
    try {
      result.inputBytes! += await checkedFile(file, input.id === 'text-extract' ? 25 : 40);
      if (input.id === 'text-extract') {
        const text = await extractDocument(file, { ocr: true, maxCharacters: 200000 }, signal);
        result.text = [result.text, `${path.basename(file)}\n\n${text}`].filter(Boolean).join('\n\n────────\n\n');
      } else if (input.id === 'pdf-extract') {
        const source = await PDFDocument.load(await fs.readFile(file));
        const indices = pageIndices(input.pages || '1', source.getPageCount());
        const document = await PDFDocument.create();
        for (const page of await document.copyPages(source, indices)) document.addPage(page);
        const output = await writeResult(folder, `${path.parse(file).name}-pages.pdf`, await document.save());
        result.outputs.push({ source: file, path: output, bytes: (await fs.stat(output)).size });
      } else {
        const { bytes, format } = await pictureBuffer(file, input);
        if (input.id === 'image-smaller' && bytes.length >= (await fs.stat(file)).size) {
          result.errors.push(`${path.basename(file)} was already smaller; no copy was made.`);
        } else {
          const extension = format === 'jpeg' ? 'jpg' : format;
          const output = await writeResult(folder, `${path.parse(file).name}-${input.id}.${extension}`, bytes);
          result.outputs.push({ source: file, path: output, bytes: bytes.length });
        }
      }
    } catch (error) {
      if (signal.aborted) throw error;
      result.errors.push(`${path.basename(file)}: ${(error as Error).message}`);
    }
    mark(file);
  }
  return result;
}
