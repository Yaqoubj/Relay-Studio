import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';

test('desktop toolbox runs image and text actions through visible controls', async () => {
  const temp = await fs.mkdtemp(path.join(os.homedir(), 'Documents', 'Relay toolbox-'));
  const source = path.join(temp, 'sample.png');
  const canvas = createCanvas(800, 480);
  const context = canvas.getContext('2d');
  context.fillStyle = '#28615c';
  context.fillRect(0, 0, 800, 480);
  context.fillStyle = '#e1cc93';
  context.fillRect(70, 60, 350, 170);
  await fs.writeFile(source, canvas.toBuffer('image/png'));
  const app = await electron.launch({
    args: ['.'],
    env: { ...process.env, RELAY_DATA_DIR: path.join(temp, 'data'), RELAY_TOOLBOX_OUTPUT_DIR: path.join(temp, 'results') },
  });
  try {
    const page = await app.firstWindow();
    await expect(page.getByRole('heading', { name: 'What do you need to do?' })).toBeVisible();
    if (process.env.RELAY_UPDATE_SCREENSHOTS) await page.screenshot({ path: 'docs/toolbox-home.png' });
    await page.getByRole('button', { name: 'All tools' }).click();
    await page.getByRole('button', { name: /Resize pictures/ }).click();
    await app.evaluate(({ dialog }, selected) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [selected] })) as typeof dialog.showOpenDialog;
    }, source);
    await page.getByRole('button', { name: 'Choose files' }).click();
    await page.getByLabel('Maximum width').fill('400');
    await page.getByRole('button', { name: 'Create result' }).click();
    await expect(page.getByText('1 file created')).toBeVisible();
    const output = path.join(temp, 'results', 'image-resize', 'sample-image-resize.png');
    const picture = await loadImage(await fs.readFile(output));
    expect(picture.width).toBe(400);
    expect(picture.height).toBe(240);
    if (process.env.RELAY_UPDATE_SCREENSHOTS) await page.screenshot({ path: 'docs/toolbox-result.png' });
    await page.locator('.toolbox-back').click();
    await page.getByRole('button', { name: /Clean pasted text/ }).click();
    await page.getByLabel('Text to clean').fill('Hello   from\nRelay');
    await page.getByRole('button', { name: 'Clean text' }).click();
    await expect(page.getByLabel('Extracted or cleaned text')).toHaveValue('Hello from Relay');
  } finally {
    await app.close();
    await fs.rm(temp, { recursive: true, force: true });
  }
});
