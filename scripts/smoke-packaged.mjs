import { _electron as electron } from '@playwright/test';
import assert from 'node:assert/strict';
import path from 'node:path';
const executablePath = path.resolve(process.argv[2] || 'dist/win-unpacked/Relay Studio.exe');
const app = await electron.launch({ executablePath });
try {
  const page = await app.firstWindow();
  await page.getByLabel('Workflow name').waitFor();
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
      return { packaged: app.isPackaged, text: (await parser.getText()).text };
    } finally {
      await parser.destroy();
    }
  });
  assert.equal(result.packaged, true);
  assert.match(result.text, /Packaged PDF works/);
  console.log('Packaged application launches; SQLite workspace, renderer, and PDF parser work.');
} finally {
  await app.close();
}
