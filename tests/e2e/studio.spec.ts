import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
test('organize existing folder previews and processes nested files', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'relay-batch-ui-'));
  const input = path.join(temp, 'inbox');
  const output = path.join(temp, 'archive');
  await fs.mkdir(path.join(input, 'nested'), { recursive: true });
  await fs.mkdir(output);
  await fs.writeFile(path.join(input, 'first.pdf'), 'first');
  await fs.writeFile(path.join(input, 'nested', 'second.pdf'), 'second');
  const app = await electron.launch({
    args: ['.'],
    env: { ...process.env, RELAY_DATA_DIR: path.join(temp, 'data') },
  });
  try {
    const page = await app.firstWindow();
    await page.getByRole('button', { name: /^Workflows/ }).click();
    await page.getByLabel('Workflow name').waitFor();
    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = (async () => ({
        canceled: false,
        filePaths: [folder],
      })) as typeof dialog.showOpenDialog;
    }, output);
    await page.evaluate(async () => {
      const folder = await window.studio.chooseFolder();
      const w = (await window.studio.snapshot()).workflows.find((w) => w.id === 'download-sorter')!;
      w.nodes.find((n) => n.data.kind === 'move')!.data.config.folder = folder!;
      await window.studio.save(w);
    });
    await page.getByRole('button', { name: 'Download organizer', exact: true }).click();
    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = (async () => ({
        canceled: false,
        filePaths: [folder],
      })) as typeof dialog.showOpenDialog;
    }, input);
    await page.getByRole('button', { name: 'Organize existing folder' }).click();
    await page.getByRole('button', { name: /Choose an existing folder/ }).click();
    await page.getByRole('checkbox', { name: /Include files inside subfolders/ }).check();
    await page.getByRole('button', { name: 'Preview workflow', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Previewed 2 of 2 files');
    expect(await fs.readdir(output)).toEqual([]);
    await page.getByRole('button', { name: 'Organize existing folder' }).click();
    await page.getByRole('button', { name: 'Run workflow', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Processed 2 of 2 files');
    expect((await fs.readdir(output)).length).toBe(2);
    expect(await fs.readdir(path.join(input, 'nested'))).toEqual([]);
    expect((await page.evaluate(() => window.studio.snapshot())).runs.length).toBe(4);
  } finally {
    await app.close();
    await fs.rm(temp, { recursive: true, force: true });
  }
});
test('create and connect steps, export a portable recipe, and import it', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'relay-editor-'));
  const exported = path.join(temp, 'recipe.json');
  const app = await electron.launch({
    args: ['.'],
    env: { ...process.env, RELAY_DATA_DIR: path.join(temp, 'data') },
  });
  try {
    const page = await app.firstWindow();
    await page.getByTitle('New workflow').click();
    await page.getByLabel('Workflow name').fill('Read my notes');
    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = (async () => ({
        canceled: false,
        filePaths: [folder],
      })) as typeof dialog.showOpenDialog;
    }, temp);
    await page.getByTitle('Browse folder').click();
    await page.getByRole('button', { name: 'Add step', exact: true }).click();
    await page
      .locator('.palette-grid')
      .getByRole('button', { name: /Read document/ })
      .click();
    await page.getByRole('button', { name: 'Fit View', exact: true }).click();
    const source = page
      .locator('.react-flow__node')
      .filter({ hasText: 'A file arrives' })
      .locator('.react-flow__handle.source');
    const target = page
      .locator('.react-flow__node')
      .filter({ hasText: 'Read document' })
      .locator('.react-flow__handle.target');
    await source.dragTo(target);
    await expect(page.locator('.react-flow__edge')).toHaveCount(1);
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(page.locator('.workflow-subtitle')).toContainText('Saved on this device');
    await app.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = (async () => ({
        canceled: false,
        filePath: file,
      })) as typeof dialog.showSaveDialog;
    }, exported);
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    await expect
      .poll(async () => {
        try {
          return JSON.parse(await fs.readFile(exported, 'utf8')).workflow.name;
        } catch {
          return '';
        }
      })
      .toBe('Read my notes');
    const recipe = JSON.parse(await fs.readFile(exported, 'utf8'));
    expect(recipe.workflow.nodes[0].data.config.folder).toBe('');
    expect(JSON.stringify(recipe)).not.toContain(temp);
    await page.getByRole('button', { name: 'Templates', exact: true }).click();
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = (async () => ({
        canceled: false,
        filePaths: [file],
      })) as typeof dialog.showOpenDialog;
    }, exported);
    await page.getByRole('button', { name: 'Import workflow', exact: true }).click();
    await expect(page.getByLabel('Workflow name')).toHaveValue('Read my notes (imported)');
    await expect(page.locator('.react-flow__node')).toHaveCount(2);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1120, 720));
    await expect(page.getByRole('button', { name: 'Test workflow', exact: true })).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
  } finally {
    await app.close();
    await fs.rm(temp, { recursive: true, force: true });
  }
});
test('desktop workflow: configure, preview, run, undo, watch, and persist', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'relay-e2e-'));
  const input = path.join(temp, 'inbox'),
    output = path.join(temp, 'archive');
  await fs.mkdir(input);
  await fs.mkdir(output);
  const sample = path.join(input, 'sample.pdf');
  await fs.writeFile(sample, 'Sample file for organizing.');
  const app = await electron.launch({
    args: ['.'],
    env: { ...process.env, RELAY_DATA_DIR: path.join(temp, 'data') },
  });
  try {
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.getByRole('button', { name: /^Workflows/ }).click();
    await expect(page.getByLabel('Workflow name')).toHaveValue('Document digest');
    await page.getByRole('button', { name: 'Download organizer', exact: true }).click();
    await expect(page.getByLabel('Workflow name')).toHaveValue('Download organizer');
    await app.evaluate(
      ({ dialog }, paths) => {
        dialog.showOpenDialog = (async () => ({
          canceled: false,
          filePaths: [paths.input],
        })) as typeof dialog.showOpenDialog;
        dialog.showMessageBox = (async () => ({
          response: 1,
          checkboxChecked: false,
        })) as typeof dialog.showMessageBox;
      },
      { input },
    );
    await page.locator('.react-flow__node').filter({ hasText: 'A download arrives' }).click();
    await page.getByTitle('Browse folder').click();
    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = (async () => ({
        canceled: false,
        filePaths: [folder],
      })) as typeof dialog.showOpenDialog;
    }, output);
    await page.locator('.react-flow__node').filter({ hasText: 'Move to my archive' }).click();
    await page.getByTitle('Browse folder').click();
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(page.locator('.workflow-subtitle')).toContainText('Saved on this device');
    await expect(page.locator('.react-flow__node')).toHaveCount(5);
    await expect(page.locator('.react-flow__node').first()).toBeVisible();
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = (async () => ({
        canceled: false,
        filePaths: [file],
      })) as typeof dialog.showOpenDialog;
    }, sample);
    await page.getByRole('button', { name: 'Test workflow', exact: true }).click();
    await page.getByRole('button', { name: /Choose a sample file/ }).click();
    await page.getByRole('button', { name: 'Preview workflow', exact: true }).click();
    await expect(page.locator('.run-inspector .state-badge')).toHaveText('success');
    expect(await fs.readdir(output)).toEqual([]);
    expect(await fs.readFile(sample, 'utf8')).toContain('Sample');
    await page.getByRole('button', { name: 'Test workflow', exact: true }).click();
    await page.getByRole('button', { name: 'Run workflow', exact: true }).click();
    await expect(page.locator('.run-inspector .state-badge')).toHaveText('success');
    await expect.poll(async () => (await fs.readdir(output)).length).toBe(1);
    expect((await fs.readdir(output))[0]).toMatch(/^\d{4}-\d{2}-\d{2}-sample.pdf$/);
    await page.getByRole('button', { name: 'Undo files', exact: true }).click();
    await expect(page.locator('.run-inspector .state-badge')).toHaveText('undone');
    expect(await fs.readdir(output)).toEqual([]);
    expect(await fs.readFile(sample, 'utf8')).toContain('Sample');
    await page.getByRole('button', { name: 'Enable watching', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Pause watcher', exact: true })).toBeVisible();
    await fs.writeFile(path.join(input, 'new.pdf'), 'New download');
    await expect.poll(async () => (await fs.readdir(output)).length, { timeout: 15000 }).toBe(1);
    await expect(page.locator('.run-inspector .state-badge')).toHaveText('success');
    await page.getByRole('button', { name: 'Pause watcher', exact: true }).click();
    await page.getByRole('button', { name: 'Close inspector', exact: true }).click();
    await page.getByRole('button', { name: 'Close execution details', exact: true }).click();
    await page.getByRole('button', { name: 'Dismiss notification', exact: true }).click();
    await expect(page.locator('.react-flow__node').first()).toBeVisible();
    await page.getByRole('button', { name: 'Fit View', exact: true }).click();
    if (process.env.RELAY_UPDATE_SCREENSHOTS) await page.screenshot({ path: 'docs/studio.png' });
    await page.getByRole('button', { name: 'Run history', exact: true }).click();
    await expect(page.locator('.history-row:not(.heading)')).toHaveCount(3);
    if (process.env.RELAY_UPDATE_SCREENSHOTS) await page.screenshot({ path: 'docs/history.png' });
    await page.getByRole('button', { name: 'Templates', exact: true }).click();
    await expect(page.locator('.template-card')).toHaveCount(3);
    await page.getByRole('button', { name: 'AI connections', exact: true }).click();
    await expect(page.getByText('Local model settings', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Cloud workspace', exact: true }).click();
    await expect(page.getByText('Connect a Relay workspace', { exact: true })).toBeVisible();
    if (process.env.RELAY_UPDATE_SCREENSHOTS) await page.screenshot({ path: 'docs/cloud.png' });
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
  const reopened = await electron.launch({
    args: ['.'],
    env: { ...process.env, RELAY_DATA_DIR: path.join(temp, 'data') },
  });
  try {
    const page = await reopened.firstWindow();
    await page.getByRole('button', { name: 'Run history', exact: true }).click();
    await expect(page.locator('.history-row:not(.heading)')).toHaveCount(3);
    await expect(page.getByText('All folder watchers paused')).toBeVisible();
  } finally {
    await reopened.close();
    await fs.rm(temp, { recursive: true, force: true });
  }
});
