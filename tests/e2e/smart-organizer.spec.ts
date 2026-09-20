import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

test('general organizer proposes groups in the chosen folder and applies a reviewed batch', async () => {
  const temp = await fs.mkdtemp(path.join(os.homedir(), 'Documents', 'Relay smart-'));
  const source = path.join(temp, 'Downloads');
  await fs.mkdir(source);
  await fs.writeFile(path.join(source, 'Show.Name.S02E03.mkv'), 'episode');
  await fs.writeFile(path.join(source, 'Show.Name.S02E03.srt'), 'subtitle');
  await fs.writeFile(path.join(source, 'invoice.pdf'), 'document');
  const app = await electron.launch({
    args: ['.'],
    env: { ...process.env, RELAY_DATA_DIR: path.join(temp, 'data') },
  });
  try {
    const page = await app.firstWindow();
    await page.getByRole('button', { name: 'File organizer', exact: true }).click();
    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = (async () => ({
        canceled: false,
        filePaths: [folder],
      })) as typeof dialog.showOpenDialog;
      dialog.showMessageBox = (async () => ({
        response: 1,
        checkboxChecked: false,
      })) as typeof dialog.showMessageBox;
    }, source);
    await page.getByRole('button', { name: 'Browse source', exact: true }).click();
    await page.getByRole('button', { name: 'Scan files', exact: true }).click();
    await page.getByRole('button', { name: 'Build review', exact: true }).click();
    await expect(page.locator('.organization-groups')).toContainText(
      'Videos / Show Name / Season 02',
    );
    await expect(page.locator('.organization-review tbody tr')).toHaveCount(3);
    if (process.env.RELAY_UPDATE_SCREENSHOTS) {
      await page.screenshot({ path: 'docs/smart-setup.png' });
      await page.locator('.organization-review').scrollIntoViewIfNeeded();
      await page.screenshot({ path: 'docs/smart-review.png' });
    }
    await page.getByLabel('I reviewed the selected changes').check();
    await page.getByRole('button', { name: 'Apply selected changes' }).click();
    await expect(page.locator('.organization-review-heading')).toContainText('complete');
    const files = await fs.readdir(path.join(source, 'Videos', 'Show Name', 'Season 02'));
    expect(files.length).toBe(2);
    await page.getByRole('button', { name: 'Undo batch', exact: true }).click();
    await expect(page.locator('.organization-review-heading')).toContainText('undone');
    await expect.poll(async () => fs.readdir(source)).toContain('invoice.pdf');
  } finally {
    await app.close();
    await fs.rm(temp, { recursive: true, force: true });
  }
});
