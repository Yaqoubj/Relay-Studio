import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

test('organizer reviews selected changes, restores saved plans, applies and undoes real files', async () => {
  const temp = await fs.mkdtemp(path.join(os.homedir(), 'Documents', 'Relay demo-'));
  const source = path.join(temp, 'Personal files');
  const destination = path.join(temp, 'Organized');
  await fs.mkdir(path.join(source, 'Travel'), { recursive: true });
  await fs.mkdir(destination);
  await fs.writeFile(path.join(source, 'Travel', 'Beach.jpg'), 'photo fixture');
  await fs.writeFile(path.join(source, 'Invoice.pdf'), 'invoice fixture');
  await fs.writeFile(path.join(source, 'Meeting notes.txt'), 'notes fixture');
  let app = await electron.launch({
    args: ['.'],
    env: { ...process.env, RELAY_DATA_DIR: path.join(temp, 'data') },
  });
  try {
    let page = await app.firstWindow();
    await page.getByRole('button', { name: 'File organizer', exact: true }).click();
    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = (async () => ({
        canceled: false,
        filePaths: [folder],
      })) as typeof dialog.showOpenDialog;
    }, source);
    await page.getByRole('button', { name: 'Browse source', exact: true }).click();
    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = (async () => ({
        canceled: false,
        filePaths: [folder],
      })) as typeof dialog.showOpenDialog;
    }, destination);
    await page.getByRole('button', { name: 'Browse destination', exact: true }).click();
    await page.getByLabel('File action').selectOption('move');
    await page.getByRole('button', { name: 'Scan files', exact: true }).click();
    await expect(page.locator('.organization-scan')).toContainText('3');
    await page.getByRole('button', { name: 'Build review', exact: true }).click();
    await expect(page.locator('.organization-review tbody tr')).toHaveCount(3);
    expect(await fs.readdir(destination)).toEqual([]);
    await expect(page.getByRole('button', { name: 'Apply selected changes' })).toBeDisabled();
    // The plan and folder grants survive restarting the app.
    await app.close();
    app = await electron.launch({
      args: ['.'],
      env: { ...process.env, RELAY_DATA_DIR: path.join(temp, 'data') },
    });
    page = await app.firstWindow();
    await page.getByRole('button', { name: 'File organizer', exact: true }).click();
    await expect(page.locator('.organization-review tbody tr')).toHaveCount(3);
    await page
      .getByLabel(`Include ${path.join(source, 'Meeting notes.txt')}`, { exact: true })
      .uncheck();
    await page.getByLabel('I reviewed the selected changes').check();
    await page.locator('.organization-review').scrollIntoViewIfNeeded();
    if (process.env.RELAY_UPDATE_SCREENSHOTS)
      await page.screenshot({ path: 'docs/organizer-review.png' });
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = (async () => ({
        response: 1,
        checkboxChecked: false,
      })) as typeof dialog.showMessageBox;
    });
    await page.getByRole('button', { name: 'Apply selected changes' }).click();
    await expect(page.locator('.organization-review-heading')).toContainText('complete');
    expect(await fs.readFile(path.join(destination, 'Photos', 'Travel', 'Beach.jpg'), 'utf8')).toBe(
      'photo fixture',
    );
    expect(await fs.readFile(path.join(source, 'Meeting notes.txt'), 'utf8')).toBe('notes fixture');
    await expect(page.getByRole('button', { name: 'Undo batch', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Undo batch', exact: true }).click();
    await expect(page.locator('.organization-review-heading')).toContainText('undone');
    expect(await fs.readFile(path.join(source, 'Invoice.pdf'), 'utf8')).toBe('invoice fixture');
    expect(await fs.readFile(path.join(source, 'Travel', 'Beach.jpg'), 'utf8')).toBe(
      'photo fixture',
    );
    await page.getByRole('button', { name: 'Templates', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'No AI needed', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'AI powered', exact: true })).toBeVisible();
    await expect(page.locator('.organization-template')).toHaveCount(16);
    if (process.env.RELAY_UPDATE_SCREENSHOTS) await page.screenshot({ path: 'docs/templates.png' });
    await page.locator('.organization-template').filter({ hasText: 'Bulk rename' }).click();
    await expect(page.getByLabel('Name pattern')).toBeVisible();
    await page.getByLabel('Name pattern').fill('{{number}}-{{stem}}{{ext}}');
    await page.getByRole('button', { name: 'Scan files', exact: true }).click();
    await page.getByRole('button', { name: 'Build review', exact: true }).click();
    await expect(page.locator('.organization-review tbody tr')).toHaveCount(3);
    await page.getByLabel('I reviewed the selected changes').check();
    await page.getByRole('button', { name: 'Apply selected changes' }).click();
    await expect(page.locator('.organization-review-heading')).toContainText('complete');
    expect(await fs.readFile(path.join(source, '0001-Invoice.pdf'), 'utf8')).toBe(
      'invoice fixture',
    );
    await page.getByRole('button', { name: 'Undo batch', exact: true }).click();
    await expect(page.locator('.organization-review-heading')).toContainText('undone');
  } finally {
    await app.close();
    await fs.rm(temp, { recursive: true, force: true });
  }
});
