import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { Worker } from 'tesseract.js';

const localRequire = createRequire(__filename);
export async function recognizeText(image: Buffer, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted();
  const { createWorker } = await import('tesseract.js');
  const language = localRequire('@tesseract.js-data/eng') as { langPath: string };
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(120000)]);
  let worker: Worker | undefined;
  let rejectJob: (error: Error) => void = () => {};
  const cancelled = new Promise<never>((_resolve, reject) => {
    rejectJob = reject;
  });
  const abort = () => {
    rejectJob(bounded.reason);
    if (worker) void worker.terminate();
  };
  bounded.addEventListener('abort', abort, { once: true });
  const initializing = createWorker('eng', 1, {
    langPath: language.langPath,
    cacheMethod: 'none',
    errorHandler: (error) => rejectJob(new Error(String(error))),
  }).then((value) => {
    worker = value;
    if (bounded.aborted) {
      void value.terminate();
      throw bounded.reason;
    }
    return value;
  });
  try {
    worker = await Promise.race([initializing, cancelled]);
    const result = await Promise.race([worker.recognize(image), cancelled]);
    if (result.data.confidence < 35)
      throw new Error('OCR could not read this image reliably. Use a clearer scan.');
    return result.data.text;
  } finally {
    bounded.removeEventListener('abort', abort);
    if (worker) await worker.terminate().catch(() => {});
  }
}
export async function extractDocument(
  file: string,
  options: { ocr: boolean; maxCharacters: number },
  signal: AbortSignal,
): Promise<string> {
  signal.throwIfAborted();
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 25 * 1024 * 1024)
    throw new Error('Document extraction requires a regular file of at most 25 MB.');
  const extension = path.extname(file).toLowerCase();
  let text: string;
  if (extension === '.pdf') {
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: await fs.readFile(file) });
    try {
      const result = await parser.getText({ first: 21, pageJoiner: '' });
      if (result.total > 20)
        throw new Error(
          'Document extraction supports up to 20 PDF pages. Split this document first.',
        );
      const pages: string[] = [];
      for (const page of result.pages) {
        signal.throwIfAborted();
        if (page.text.trim()) pages.push(page.text);
        else {
          if (!options.ocr)
            throw new Error('This PDF contains a page without text. Enable local OCR.');
          const rendered = await parser.getScreenshot({
            partial: [page.num],
            desiredWidth: 1800,
            imageDataUrl: false,
          });
          pages.push(await recognizeText(Buffer.from(rendered.pages[0].data), signal));
        }
      }
      text = pages.join('\n\n');
    } finally {
      await parser.destroy();
    }
  } else if (extension === '.docx') {
    const mammoth = await import('mammoth');
    text = (await mammoth.extractRawText({ path: file })).value;
  } else if (['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.tif', '.tiff'].includes(extension)) {
    if (!options.ocr) throw new Error('Enable local OCR to read image text.');
    text = await recognizeText(await fs.readFile(file), signal);
  } else if (
    ['.txt', '.md', '.csv', '.json', '.log', '.html', '.xml', '.yaml', '.yml'].includes(extension)
  ) {
    text = await fs.readFile(file, 'utf8');
    if (text.includes('\0')) throw new Error('This document appears to be binary.');
  } else throw new Error('Supported documents: text, PDF, DOCX, and OCR-readable images.');
  signal.throwIfAborted();
  if (!text.trim()) throw new Error('No readable text was found.');
  if (text.length > options.maxCharacters)
    throw new Error(
      `Extracted text exceeds the ${options.maxCharacters.toLocaleString()} character limit. Split the document or raise the limit.`,
    );
  return text;
}
