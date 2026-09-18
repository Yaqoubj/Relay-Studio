import fs from 'node:fs/promises';
import path from 'node:path';

// Collect before running so newly generated output cannot enter the batch.
export async function collectFiles(folder: string, recursive: boolean, excluded: string[] = []) {
  const root = await fs.realpath(folder);
  const exclusions = await Promise.all(excluded.map((p) => fs.realpath(p)));
  if (exclusions.includes(root))
    throw new Error('Choose an output folder different from the input folder.');
  const files: string[] = [];
  async function visit(dir: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const file = path.join(dir, entry.name);
      if (exclusions.includes(file)) continue;
      if (entry.isDirectory() && recursive) await visit(file);
      if (entry.isFile()) {
        files.push(file);
        if (files.length > 1000)
          throw new Error('This folder contains more than 1,000 files. Choose a smaller folder.');
      }
    }
  }
  await visit(root);
  return files;
}
