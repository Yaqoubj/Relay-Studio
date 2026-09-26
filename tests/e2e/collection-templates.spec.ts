import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createServer } from 'node:http';

test('duplicate review, saved schedules, backup comparison and AI draft review work through the desktop bridge', async () => {
  const temp = await fs.mkdtemp(path.join(os.homedir(), 'Documents', 'Relay templates-'));
  const source = path.join(temp, 'Files');
  const destination = path.join(temp, 'Archive');
  await fs.mkdir(source);
  await fs.mkdir(destination);
  await fs.writeFile(path.join(source, 'Receipt.txt'), 'Shop receipt dated 2026-09-18. USD 14.50');
  await fs.writeFile(
    path.join(source, 'Receipt copy.txt'),
    'Shop receipt dated 2026-09-18. USD 14.50',
  );
  let requests = 0;
  const server = createServer(async (req, res) => {
    for await (const _chunk of req) {
      /* Consume the real model request. */
    }
    requests++;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        message: {
          content: JSON.stringify({
            merchant: 'Shop',
            date: '2026-09-18',
            currency: 'USD',
            total: '14.50',
            confidence: '0.95',
            reason: 'Receipt total states USD 14.50.',
          }),
        },
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  const app = await electron.launch({
    args: ['.'],
    env: { ...process.env, RELAY_DATA_DIR: path.join(temp, 'data') },
  });
  try {
    const page = await app.firstWindow();
    await page.getByRole('button', { name: 'File organizer', exact: true }).click();
    await page.getByRole('button', { name: 'Advanced tools' }).click();
    await page.getByLabel('Organizer template').selectOption('duplicates');
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = (async () => ({
        response: 1,
        checkboxChecked: false,
      })) as typeof dialog.showMessageBox;
    });
    for (const [button, folder] of [
      ['Browse source', source],
      ['Browse destination', destination],
    ]) {
      await app.evaluate(({ dialog }, folder) => {
        dialog.showOpenDialog = (async () => ({
          canceled: false,
          filePaths: [folder],
        })) as typeof dialog.showOpenDialog;
      }, folder);
      await page.getByRole('button', { name: button, exact: true }).click();
    }
    await page.getByLabel('Organizer template').selectOption('duplicates');
    await page.getByRole('button', { name: 'Scan files', exact: true }).click();
    await page.getByRole('button', { name: 'Build review', exact: true }).click();
    await expect(page.locator('.organization-review tbody tr')).toHaveCount(1);
    await expect(page.locator('.organization-review')).toContainText('Identical SHA-256');
    await page.locator('.organization-presets > summary').click();
    await page.getByLabel('Saved organizer name').fill('Daily duplicate review');
    await page.getByLabel('Schedule automatic reviews').check();
    await page.getByRole('button', { name: 'Save workflow setup', exact: true }).click();
    await expect(page.locator('.organization-preset-list')).toContainText('Daily duplicate review');
    await page.getByRole('button', { name: 'Pause schedule', exact: true }).click();
    await expect(page.locator('.organization-preset-list')).toContainText('Manual reviews');
    await page.getByRole('button', { name: 'Prepare review now', exact: true }).click();
    await expect(page.locator('.organization-review tbody tr')).toHaveCount(1);
    expect(await fs.readdir(destination)).toEqual([]);
    await page.getByLabel('Organizer template').selectOption('backup');
    await page.getByRole('button', { name: 'Build review', exact: true }).click();
    await expect(page.locator('.organization-review tbody tr')).toHaveCount(2);
    await page.getByLabel('I reviewed the selected changes').check();
    await page.getByRole('button', { name: 'Apply selected changes' }).click();
    await expect(page.locator('.organization-review-heading')).toContainText('complete');
    await page.getByRole('button', { name: 'Build review', exact: true }).click();
    await expect(page.locator('.organization-analysis')).toContainText('2 files match by hash');
    await expect(page.locator('.organization-review tbody tr')).toHaveCount(0);
    await page.evaluate(async (endpoint) => {
      await window.studio.settings({
        provider: 'ollama',
        endpoint,
        model: 'test-receipts',
        allowCloud: false,
        hasKey: false,
      });
    }, `http://127.0.0.1:${address.port}`);
    await page.getByLabel('Organizer template').selectOption('ai-receipts');
    await page.getByRole('button', { name: 'Build review', exact: true }).click();
    await expect(page.locator('.organization-review tbody tr')).toHaveCount(2);
    await expect(page.locator('.organization-analysis')).toContainText('cached results');
    expect(requests).toBe(1); // Same content and model reuse the result.
    await page.locator('.organization-content > summary').first().click();
    await expect(page.locator('.organization-content pre').first()).toContainText('14.50');
    await page.locator('.organization-review').scrollIntoViewIfNeeded();
    if (process.env.RELAY_UPDATE_SCREENSHOTS) await page.screenshot({ path: 'docs/ai-review.png' });
    expect((await fs.readdir(destination)).filter((name) => name.endsWith('.json'))).toEqual([]);
    await page.getByLabel('I reviewed the selected changes').check();
    await page.getByRole('button', { name: 'Apply selected changes' }).click();
    await expect(page.locator('.organization-review-heading')).toContainText('complete');
    expect((await fs.readdir(destination)).filter((name) => name.endsWith('.json')).length).toBe(2);
    await page.getByRole('button', { name: 'Undo batch', exact: true }).click();
    await expect(page.locator('.organization-review-heading')).toContainText('undone');
    await page.getByRole('button', { name: 'Templates', exact: true }).click();
    await page.getByRole('heading', { name: 'AI powered', exact: true }).scrollIntoViewIfNeeded();
    await page.locator('.page-content').evaluate((element) => {
      const heading = [...element.querySelectorAll('h2')].find(
        (node) => node.textContent === 'AI powered',
      );
      if (heading)
        element.scrollTop +=
          heading.getBoundingClientRect().top - element.getBoundingClientRect().top - 28;
    });
    if (process.env.RELAY_UPDATE_SCREENSHOTS)
      await page.screenshot({ path: 'docs/ai-templates.png' });
  } finally {
    await app.close();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await fs.rm(temp, { recursive: true, force: true });
  }
});
