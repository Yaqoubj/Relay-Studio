import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { collectFiles } from '../src/desktop/batch';
import { createPersonalTemp } from './support/personal-temp';

test('existing folder collection includes nested files only when requested and excludes outputs', async (t) => {
  const root = await createPersonalTemp('batch-');
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const nested = path.join(root, 'nested');
  const output = path.join(root, 'archive');
  await fs.mkdir(nested);
  await fs.mkdir(output);
  await fs.writeFile(path.join(root, 'one.txt'), 'one');
  await fs.writeFile(path.join(nested, 'two.txt'), 'two');
  await fs.writeFile(path.join(output, 'old.txt'), 'old output');
  assert.deepEqual(await collectFiles(root, false, [output]), [path.join(root, 'one.txt')]);
  assert.deepEqual(
    (await collectFiles(root, true, [output])).sort(),
    [path.join(nested, 'two.txt'), path.join(root, 'one.txt')].sort(),
  );
  await assert.rejects(collectFiles(root, true, [root]), /different/);
});
