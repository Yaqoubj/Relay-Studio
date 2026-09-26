import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// AppData and the repository are deliberately protected by Relay's file policy.
export async function createPersonalTemp(prefix: string) {
  const documents = path.join(os.homedir(), 'Documents');
  await fs.mkdir(documents, { recursive: true });
  return fs.mkdtemp(path.join(documents, `Relay test ${prefix}`));
}
