import { _electron as electron } from '@playwright/test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
const executablePath = path.resolve(process.argv[2] || 'dist/win-unpacked/Relay Studio.exe');
const data = await fs.mkdtemp(path.join(os.tmpdir(), 'relay-packaged-smoke-'));
const app = await electron.launch({
  executablePath,
  env: { ...process.env, RELAY_DATA_DIR: data },
});
try {
  const page = await app.firstWindow();
  await page.getByRole('heading', { name: 'What do you need to do?' }).waitFor();
  assert.equal(await page.title(), 'Relay Studio');
  const result = await app.evaluate(async ({ app }) => {
    const { createRequire } = process.getBuiltinModule('module');
    const load = createRequire(
      process.getBuiltinModule('path').join(app.getAppPath(), 'package.json'),
    );
    const { PDFParse } = load('pdf-parse');
    const stream = 'BT /F1 12 Tf 50 100 Td (Packaged PDF works) Tj ET';
    const objects = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    ];
    let pdf = '%PDF-1.4\n';
    const offsets = [];
    objects.forEach((body, i) => {
      offsets.push(Buffer.byteLength(pdf));
      pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
    });
    const xref = Buffer.byteLength(pdf);
    pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.map((n) => String(n).padStart(10, '0') + ' 00000 n ').join('\n')}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    const parser = new PDFParse({ data: Buffer.from(pdf) });
    try {
      const text = (await parser.getText()).text;
      const screenshot = (
        await parser.getScreenshot({ first: 1, desiredWidth: 1800, imageDataUrl: false })
      ).pages[0].data;
      const { createWorker } = load('tesseract.js');
      const { langPath } = load('@tesseract.js-data/eng');
      const { createCanvas, loadImage } = load('@napi-rs/canvas');
      const { PDFDocument } = load('pdf-lib');
      const createdPdf = await PDFDocument.create();
      createdPdf.addPage([300, 200]);
      const savedPdf = await createdPdf.save();
      const reopenedPdf = await PDFDocument.load(savedPdf);
      const canvas = createCanvas(9, 8);
      canvas.getContext('2d').fillRect(0, 0, 9, 8);
      const decoded = await loadImage(canvas.toBuffer('image/png'));
      let worker;
      let timeout;
      try {
        const ocr = await Promise.race([
          (async () => {
            worker = await createWorker('eng', 1, { langPath, cacheMethod: 'none' });
            return (await worker.recognize(Buffer.from(screenshot))).data.text;
          })(),
          new Promise((_, reject) => {
            timeout = setTimeout(() => reject(new Error('Packaged OCR timed out.')), 45000);
          }),
        ]);
        return {
          packaged: app.isPackaged,
          text,
          ocr,
          docx: typeof load('mammoth').extractRawText,
          exif: typeof load('exifr').parse,
          image: decoded.width === 9 && decoded.height === 8,
          pdfWriting: reopenedPdf.getPageCount() === 1,
        };
      } finally {
        clearTimeout(timeout);
        if (worker) await worker.terminate();
      }
    } finally {
      await parser.destroy();
    }
  });
  assert.equal(result.packaged, true);
  assert.match(result.text, /Packaged PDF works/);
  assert.match(result.ocr, /Packaged PDF works/i);
  assert.equal(result.docx, 'function');
  assert.equal(result.exif, 'function');
  assert.equal(result.image, true);
  assert.equal(result.pdfWriting, true);
  console.log(
    'Packaged application launches; renderer, PDF read/write, offline OCR, DOCX, EXIF and image dependencies work.',
  );
} finally {
  await app.close();
  await fs.rm(data, { recursive: true, force: true });
}
