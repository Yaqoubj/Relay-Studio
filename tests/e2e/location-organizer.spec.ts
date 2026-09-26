import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createPersonalTemp } from '../support/personal-temp';

async function anonymizeFixturePaths(page: import('@playwright/test').Page, root: string) {
  await page.evaluate((fixtureRoot) => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if (node.nodeValue?.includes(fixtureRoot)) {
        node.nodeValue = node.nodeValue.replaceAll(fixtureRoot, 'C:\\Users\\Alex\\Documents\\Relay Demo');
      }
    }
  }, root);
}

test('primary organizer groups related files, applies, undoes, and searches an indexed library', async () => {
  const temp = await createPersonalTemp('location-');
  const source = path.join(temp, 'Downloads');
  const season = path.join(source, 'Videos', 'The Expanse', 'Season 01');
  const library = path.join(temp, 'Reference files');
  await fs.mkdir(season, { recursive: true });
  await fs.mkdir(library);
  await fs.writeFile(path.join(source, 'The.Expanse.S01E02.mkv'), 'episode fixture');
  await fs.writeFile(path.join(source, 'The.Expanse.S01E02.en.srt'), 'subtitle fixture');
  await fs.writeFile(path.join(source, 'invoice.txt'), 'INVOICE\nTOTAL\nMerchant: Demo');
  await fs.writeFile(path.join(library, 'reference.txt'), 'A document for library search.');
  const app = await electron.launch({
    args: ['.'],
    env: { ...process.env, RELAY_DATA_DIR: path.join(temp, 'data') },
  });
  try {
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1480, height: 960 });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.getByRole('button', { name: 'File organizer', exact: true }).click();
    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [folder] })) as typeof dialog.showOpenDialog;
    }, source);
    await page.getByRole('button', { name: 'Choose folder', exact: true }).click();
    await expect(page.locator('.location-group')).toHaveCount(2);
    const episodeGroup = page.locator('.location-group').filter({ hasText: 'The.Expanse.S01E02.mkv' });
    const invoiceGroup = page.locator('.location-group').filter({ hasText: 'invoice.txt' });
    await expect(episodeGroup).toContainText('The Expanse · Season 1');
    await expect(episodeGroup).toContainText(path.join(season));
    await expect(invoiceGroup).toContainText('Two local content signals match invoice');
    await expect(page.getByRole('button', { name: /Organize 3 files/ })).toBeEnabled();
    expect(await fs.readdir(source)).toContain('invoice.txt');
    if (process.env.RELAY_UPDATE_SCREENSHOTS) {
      await anonymizeFixturePaths(page, temp);
      await page.screenshot({ path: 'docs/organizer-collections.png', fullPage: true });
      await page.setViewportSize({ width: 1120, height: 720 });
      await page.screenshot({ path: 'docs/organizer-compact.png' });
      await page.setViewportSize({ width: 1480, height: 960 });
    }
    await page.getByRole('button', { name: /Organize 3 files/ }).click();
    await expect(page.locator('.location-review-heading')).toContainText('3 files moved');
    expect(await fs.readFile(path.join(season, 'The.Expanse.S01E02.mkv'), 'utf8')).toBe('episode fixture');
    expect(await fs.readFile(path.join(season, 'The.Expanse.S01E02.en.srt'), 'utf8')).toBe('subtitle fixture');
    await expect(page.getByRole('button', { name: 'Undo this batch' })).toBeEnabled();
    await page.getByRole('button', { name: 'Undo this batch' }).click();
    await expect(page.locator('.location-review-heading')).toContainText('undone');
    expect(await fs.readFile(path.join(source, 'invoice.txt'), 'utf8')).toContain('INVOICE');
    if (process.env.RELAY_UPDATE_SCREENSHOTS) {
      await anonymizeFixturePaths(page, temp);
      await page.screenshot({ path: 'docs/organizer-complete.png', fullPage: true });
    }

    await page.getByRole('button', { name: 'Library', exact: true }).click();
    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [folder] })) as typeof dialog.showOpenDialog;
    }, library);
    await page.getByRole('button', { name: 'Add location', exact: true }).click();
    await expect(page.locator('.location-scopes')).toContainText('1 files');
    await page.getByRole('textbox', { name: 'Search library' }).fill('document for library search');
    await expect(page.locator('.location-search-results')).toContainText('reference.txt');
    if (process.env.RELAY_UPDATE_SCREENSHOTS) {
      await anonymizeFixturePaths(page, temp);
      await page.screenshot({ path: 'docs/library-overview.png' });
    }
    expect(errors).toEqual([]);
  } finally {
    await app.close();
    await fs.rm(temp, { recursive: true, force: true });
  }
});
