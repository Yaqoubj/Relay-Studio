import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Notification,
  safeStorage,
  shell,
} from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import type { FSWatcher } from 'chokidar';
import { Store } from './database';
import { RelayCloudClient, type CloudSession } from './cloud';
import { execute, undoRun } from './engine';
import { collectFiles } from './batch';
import { scanFiles, buildPlan, applyPlan, undoPlan } from './organizer';
import { updateDeliveryManifest } from './collection-analysis';
import { needsAI, organizerTemplates, type OrganizerPreset } from '../shared/organizer';
import { MaintenanceQueue } from './maintenance';
import { LocationManager } from './location-manager';
import { assertSafeDirectory } from './file-policy';
import { checkPath, within } from './organizer';
import type {
  PrepareLocation,
  LocationChoice,
  FilingRule,
  TidyLocation,
} from '../shared/organize-location';
import { runToolbox, validateToolboxInput } from './toolbox';
import type { ToolboxInput, ToolboxResult } from '../shared/toolbox';
import type {
  ScanResult,
  OrganizationPlan,
  OrganizerProgress,
  ScanOptions,
  PlanOptions,
} from '../shared/organizer';
import { validateRunnable, validateWorkflow } from './validation';
import { transform, validateEndpoint } from './ai';
import type { AISettings, CloudSettings, Run, Workflow } from '../shared/types';
if (process.env.RELAY_DATA_DIR) app.setPath('userData', process.env.RELAY_DATA_DIR);
let win: BrowserWindow,
  store: Store,
  active: AbortController | null = null,
  quitting = false,
  closeAfterRun = false,
  cloudClient: RelayCloudClient | null = null;
const watchers = new Map<string, FSWatcher>();
const queue: { workflow: Workflow; source: string }[] = [];
const files = new Set<string>();
let organizationScan: ScanResult | null = null;
let organizationPlan: OrganizationPlan | null = null;
let organizationProgress: OrganizerProgress | null = null;
let lastProgress = 0;
function reportOrganizationProgress(progress: OrganizerProgress) {
  organizationProgress = progress;
  if (Date.now() - lastProgress > 150 && win && !win.isDestroyed()) {
    lastProgress = Date.now();
    win.webContents.send('studio:organizer-progress', progress);
  }
}
async function organizationTask<T>(stage: string, task: (signal: AbortSignal) => Promise<T>) {
  idle();
  if (watchers.size) throw new Error('Pause folder watchers before organizing files.');
  const controller = new AbortController();
  active = controller;
  reportOrganizationProgress({ stage, count: 0 });
  update();
  try {
    return await task(controller.signal);
  } finally {
    active = null;
    organizationProgress = null;
    if (win && !win.isDestroyed()) win.webContents.send('studio:organizer-progress', null);
    update();
    if (closeAfterRun) {
      closeAfterRun = false;
      win.close();
    } else void drain();
  }
}
const page = path.join(__dirname, 'renderer', 'index.html');
function update() {
  if (win && !win.isDestroyed()) win.webContents.send('studio:update');
}
function idle() {
  if (active) throw new Error('Wait for the current run to finish or cancel it first.');
}
function settings(): AISettings {
  return {
    provider: 'ollama',
    endpoint: 'http://127.0.0.1:11434',
    model: '',
    allowCloud: false,
    ...JSON.parse(store.get('ai-settings') || '{}'),
    hasKey: !!store.get('ai-key'),
  };
}
async function prepareOrganizationReview(options: PlanOptions, signal: AbortSignal) {
  if (!organizationScan) throw new Error('Scan a folder first.');
  await allowFolder(organizationScan.root);
  if (
    options.template !== 'rename' &&
    !(['smart', 'smart-ai'].includes(options.template) && options.placement !== 'elsewhere')
  )
    await allowFolder(options.destination);
  const config = settings();
  if (needsAI(options.template)) {
    validateEndpoint(config);
    if (config.provider === 'cloud' && (!config.allowCloud || !apiKey()))
      throw new Error('Enable cloud document processing and add your key in AI connections first.');
    const answer = await dialog.showMessageBox(win, {
      message: 'Use your model to improve this organization plan?',
      detail: `Provider: ${config.provider}\nModel: ${config.model}\nEndpoint: ${config.endpoint}\nUp to ${options.maxAIRequests ?? 20} files/requests, ${options.maxCharacters ?? 20000} characters per file (1,000,000 per batch). ${config.provider === 'cloud' ? 'Extracted document text is sent to this provider; charges may apply.' : 'Document text is sent to your local model.'} OCR runs locally. No file changes are applied during analysis.`,
      buttons: ['Cancel', 'Analyze'],
      defaultId: 0,
      cancelId: 0,
    });
    if (answer.response !== 1) return false;
  }
  signal.throwIfAborted();
  const key = needsAI(options.template) && config.provider === 'cloud' ? apiKey() : '';
  const plan = await buildPlan(organizationScan, options, signal, {
    progress: reportOrganizationProgress,
    ai: (text, step, abort) => transform(config, key, text, step, abort),
    fingerprint: JSON.stringify({
      provider: config.provider,
      endpoint: config.endpoint,
      model: config.model,
    }),
    cached: (cacheKey) => store.aiCached(cacheKey),
    cache: (cacheKey, value) => store.cacheAI(cacheKey, value),
  });
  store.putOrganizationPlan(plan, undefined, true);
  organizationPlan = plan;
  store.set('organization-current', plan.id);
  return true;
}
function organizationPresets(): OrganizerPreset[] {
  return JSON.parse(store.get('organization-presets') || '[]');
}
async function runOrganizationPreset(preset: OrganizerPreset) {
  return organizationTask('Preparing saved workflow', async (signal) => {
    await allowFolder(preset.scan.root);
    organizationScan = await scanFiles(preset.scan, signal, reportOrganizationProgress);
    store.putOrganizationScan(organizationScan);
    if (!(await prepareOrganizationReview(preset.options, signal)))
      throw new Error('Analysis was cancelled.');
    return organizationPlan!.id;
  });
}
function apiKey() {
  const cipher = store.get('ai-key');
  if (!cipher) return '';
  if (!safeStorage.isEncryptionAvailable())
    throw new Error('The operating system credential store is unavailable.');
  return safeStorage.decryptString(Buffer.from(cipher, 'base64'));
}
function cloudConfig(): CloudSettings {
  return {
    baseUrl: 'http://127.0.0.1:4317',
    email: '',
    workspaceName: '',
    workspaceId: '',
    ...JSON.parse(store.get('cloud-settings') || '{}'),
    connected: false,
  };
}
function cloudToken() {
  const cipher = store.get('cloud-token');
  if (!cipher) return '';
  if (!safeStorage.isEncryptionAvailable())
    throw new Error('The operating system credential store is unavailable.');
  return safeStorage.decryptString(Buffer.from(cipher, 'base64'));
}
function cloud() {
  if (cloudClient) return cloudClient;
  const config = cloudConfig();
  const token = cloudToken();
  if (!token || !config.workspaceId) return null;
  cloudClient = new RelayCloudClient(config.baseUrl, token);
  return cloudClient;
}
function cloudSnapshot(): CloudSettings {
  const config = cloudConfig();
  return {
    ...config,
    baseUrl: config.baseUrl || 'http://127.0.0.1:4317',
    connected: !!(store.get('cloud-token') && config.workspaceId),
  };
}
function saveCloudSession(baseUrl: string, session: CloudSession) {
  if (
    !safeStorage.isEncryptionAvailable() ||
    (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')
  )
    throw new Error('Secure credential storage is unavailable on this system.');
  store.set('cloud-token', safeStorage.encryptString(session.token).toString('base64'));
  store.set(
    'cloud-settings',
    JSON.stringify({
      baseUrl,
      email: session.user.email,
      workspaceId: session.workspace.id,
      workspaceName: session.workspace.name,
    }),
  );
  cloudClient = new RelayCloudClient(baseUrl, session.token);
}
function notify(message: string) {
  if (Notification.isSupported()) new Notification({ title: 'Relay Studio', body: message }).show();
}
async function allowFolder(folder: string) {
  const actual = await fs.realpath(folder);
  const grants: string[] = JSON.parse(store.get('folders') || '[]');
  if (!grants.includes(actual)) throw new Error('Choose this folder using Browse to grant access.');
  if (!(await fs.stat(actual)).isDirectory()) throw new Error('The destination is not a folder.');
}
async function stopWatching(id: string) {
  const watcher = watchers.get(id);
  watchers.delete(id);
  if (watcher) await watcher.close();
  for (let i = queue.length - 1; i >= 0; i--) if (queue[i].workflow.id === id) queue.splice(i, 1);
  update();
}
async function startRun(w: Workflow, source: string, preview: boolean, origin: Run['origin']) {
  idle();
  const controller = new AbortController();
  active = controller;
  update();
  try {
    const result = await execute(w, source, preview, origin, {
      signal: controller.signal,
      allowFolder,
      update: (r) => {
        store.putRun(r);
        update();
      },
      ai: (text, config, signal) => transform(settings(), apiKey(), text, config, signal),
      notify,
    });
    const client = cloud();
    if (client && result.status !== 'running') {
      try {
        await client.recordRun(cloudConfig().workspaceId!, result);
      } catch (error) {
        notify(`Cloud sync skipped: ${(error as Error).message}`);
      }
    }
    return result;
  } finally {
    active = null;
    update();
    if (closeAfterRun) {
      closeAfterRun = false;
      win.close();
    } else void drain();
  }
}
async function drain() {
  if (active || quitting || !queue.length) return;
  const next = queue.shift()!;
  if (!watchers.has(next.workflow.id)) {
    void drain();
    return;
  }
  try {
    await startRun(next.workflow, next.source, false, 'watch');
  } catch (error) {
    notify(`Workflow could not start: ${(error as Error).message}`);
  }
}
async function enableWatch(w: Workflow) {
  validateRunnable(w);
  const folder = w.nodes.find((n) => n.data.kind === 'trigger')!.data.config.folder;
  await allowFolder(folder);
  const source = await fs.realpath(folder);
  for (const other of store.workflows().filter((other) => watchers.has(other.id))) {
    const otherFolder = other.nodes.find((n) => n.data.kind === 'trigger')!.data.config.folder;
    if ((await fs.realpath(otherFolder)) === source)
      throw new Error('Only one workflow can watch a folder at a time.');
    for (const n of other.nodes.filter((n) => ['copy', 'move', 'write'].includes(n.data.kind))) {
      if ((await fs.realpath(n.data.config.folder)) === source)
        throw new Error(
          'This folder is an active workflow’s output. Chained folder watchers are disabled to prevent loops.',
        );
    }
    for (const n of w.nodes.filter((n) => ['copy', 'move', 'write'].includes(n.data.kind))) {
      if ((await fs.realpath(n.data.config.folder)) === (await fs.realpath(otherFolder)))
        throw new Error(
          'An output folder is watched by another workflow. Chained folder watchers are disabled to prevent loops.',
        );
    }
  }
  for (const n of w.nodes)
    if (['move', 'copy', 'write'].includes(n.data.kind)) {
      await allowFolder(n.data.config.folder);
      if ((await fs.realpath(n.data.config.folder)) === source)
        throw new Error(
          'Choose an output folder outside the watched folder to prevent repeat runs.',
        );
    }
  // Renaming within a watched folder creates another add event. Require a move first.
  for (const node of w.nodes.filter((n) => n.data.kind === 'rename')) {
    let current = node.id,
      moved = false;
    while (true) {
      const edge = w.edges.find((e) => e.target === current);
      if (!edge) break;
      const parent = w.nodes.find((n) => n.id === edge.source)!;
      if (parent.data.kind === 'move') moved = true;
      current = parent.id;
    }
    if (!moved)
      throw new Error(
        'For folder watching, place Move file before Rename file to avoid retriggering the renamed file.',
      );
  }
  const { watch } = await import('chokidar');
  const watcher = watch(source, {
    ignoreInitial: true,
    depth: 0,
    followSymlinks: false,
    awaitWriteFinish: { stabilityThreshold: 1500, pollInterval: 250 },
  });
  watchers.set(w.id, watcher);
  watcher.on('add', (file) => {
    if (!watchers.has(w.id)) return;
    if (queue.length >= 100) {
      notify('The file queue is full. Pause watching and run missed files manually.');
      return;
    }
    if (!queue.some((q) => q.workflow.id === w.id && q.source === file))
      queue.push({ workflow: structuredClone(w), source: file });
    void drain();
  });
  watcher.on('error', (error) => {
    notify(`Folder watcher stopped: ${String(error)}`);
    void stopWatching(w.id);
  });
  await new Promise<void>((resolve, reject) => {
    watcher.once('ready', resolve);
    watcher.once('error', reject);
  });
  update();
}
function handle(channel: string, action: (...args: any[]) => unknown) {
  ipcMain.handle(`studio:${channel}`, async (event, ...args) => {
    if (
      event.senderFrame !== win.webContents.mainFrame ||
      event.senderFrame.url !== pathToFileURL(page).href
    )
      throw new Error('Untrusted request.');
    return action(...args);
  });
}
function createWindow() {
  win = new BrowserWindow({
    width: 1480,
    height: 960,
    minWidth: 1120,
    minHeight: 720,
    title: 'Relay Studio',
    backgroundColor: '#101316',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false),
  );
  void win.loadFile(page);
  win.webContents.on('will-prevent-unload', (event) => {
    const answer = dialog.showMessageBoxSync(win, {
      message: 'Discard unsaved workflow edits and close?',
      buttons: ['Keep editing', 'Discard and close'],
      defaultId: 0,
      cancelId: 0,
    });
    if (answer === 1) event.preventDefault();
    else quitting = false;
  });
  win.on('close', (event) => {
    if (quitting) return;
    if (active || watchers.size) {
      const answer = dialog.showMessageBoxSync(win, {
        type: 'question',
        message: 'Close Relay Studio?',
        detail:
          'Folder watching will stop. An active run will be cancelled after its current file operation.',
        buttons: ['Keep open', 'Close'],
        defaultId: 0,
        cancelId: 0,
      });
      if (answer === 0) {
        event.preventDefault();
        return;
      }
    }
    quitting = true;
    for (const id of watchers.keys()) void stopWatching(id);
    if (active) {
      event.preventDefault();
      closeAfterRun = true;
      active.abort(new Error('App closing.'));
    }
  });
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });
  app.whenReady().then(async () => {
    try {
      await fs.mkdir(app.getPath('userData'), { recursive: true });
      store = new Store(path.join(app.getPath('userData'), 'relay.sqlite'));
      organizationScan = store.organizationScan();
      const latestPlan = store.get('organization-current');
      if (latestPlan) organizationPlan = store.organizationPlan(latestPlan);
    } catch (error) {
      dialog.showErrorBox('Unable to open workspace', String(error));
      app.quit();
      return;
    }
    createWindow();
    const locations = new LocationManager(store, {
      allowFolder,
      progress: reportOrganizationProgress,
      changed: update,
      services: () => ({
        progress: reportOrganizationProgress,
        cached: (key) => store.aiCached(key),
        cache: (key, text) => store.cacheAI(key, text),
        ai: (text, config, signal) => transform(settings(), apiKey(), text, config, signal),
      }),
    });
    handle('location-state', async () => {
      await locations.libraryState();
      return locations.state();
    });
    handle('location-pick', async (known?: 'downloads' | 'desktop' | 'documents') => {
      if (known !== undefined && !['downloads', 'desktop', 'documents'].includes(known))
        throw new Error('Unknown location.');
      const result = await dialog.showOpenDialog(win, {
        properties: ['openDirectory'],
        ...(known ? { defaultPath: app.getPath(known) } : {}),
      });
      if (result.canceled) return null;
      await checkPath(result.filePaths[0]);
      const folder = await fs.realpath(result.filePaths[0]);
      await assertSafeDirectory(folder);
      const grants = new Set<string>(JSON.parse(store.get('folders') || '[]'));
      grants.add(folder);
      store.set('folders', JSON.stringify([...grants]));
      return folder;
    });
    handle('location-prepare', (input: PrepareLocation) =>
      organizationTask('Preparing collections', async (signal) => {
        if (input?.ai) {
          const config = settings();
          validateEndpoint(config);
          if (!config.model || (config.provider === 'cloud' && (!config.allowCloud || !apiKey())))
            throw new Error('Set up your model in AI connections first.');
          const answer = await dialog.showMessageBox(win, {
            message: 'Analyze document text with your model?',
            detail: `Up to 20 requests to ${config.endpoint}. ${config.provider === 'cloud' ? 'Document text leaves this computer and API charges may apply.' : 'Text is sent to your configured local model.'} Suggestions stay in the review.`,
            buttons: ['Cancel', 'Analyze'],
            defaultId: 0,
            cancelId: 0,
          });
          if (answer.response !== 1) return;
        }
        await locations.prepare(input, signal);
      }),
    );
    handle('location-choose', (choice: LocationChoice) =>
      organizationTask('Updating collection', (signal) => locations.choose(choice, signal)),
    );
    handle('location-apply', (id: string, revision: number) =>
      organizationTask('Organizing', (signal) => locations.apply(id, revision, signal)),
    );
    handle('location-undo', (id: string) =>
      organizationTask('Undoing organization', (signal) => locations.undo(id, signal)),
    );
    handle('location-load', (id: string) => {
      idle();
      locations.load(id);
    });
    handle('location-details', (id: string, offset: number) => locations.details(id, offset));
    handle('location-rule', (rule: FilingRule, remove?: boolean) =>
      organizationTask('Saving filing choice', async () => {
        if (remove !== undefined && typeof remove !== 'boolean')
          throw new Error('Invalid rule operation.');
        await locations.editRule(rule, remove);
      }),
    );
    handle('location-tidy', (root: string, enabled: boolean) =>
      organizationTask('Saving tidy location', (signal) => locations.tidy(root, enabled, signal)),
    );
    handle('location-folders', async (root: string) => {
      await allowFolder(root);
      await checkPath(root);
      return (await fs.readdir(root, { withFileTypes: true }))
        .filter(
          (entry) => entry.isDirectory() && !entry.isSymbolicLink() && !entry.name.startsWith('.'),
        )
        .slice(0, 500)
        .map((entry) => ({ name: entry.name, path: path.join(root, entry.name) }));
    });
    handle('location-preview', async (id: string, fileId: string) => {
      const plan = store.organizationPlan(id),
        item = plan.items.find((item) => item.id === fileId);
      if (!item || !within(plan.root, item.source) || !/\.(png|jpe?g|webp|bmp)$/i.test(item.source))
        return '';
      await allowFolder(plan.root);
      await checkPath(item.source);
      const stat = await fs.lstat(item.source);
      if (!stat.isFile() || stat.size > 15 * 1024 ** 2) return '';
      const { createCanvas, loadImage } = await import('@napi-rs/canvas');
      const image = await loadImage(item.source);
      if (image.width * image.height > 40000000) return '';
      const scale = Math.min(1, 240 / image.width, 150 / image.height);
      const canvas = createCanvas(
        Math.max(1, Math.round(image.width * scale)),
        Math.max(1, Math.round(image.height * scale)),
      );
      canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/jpeg');
    });
    handle('location-open', async (id: string, groupId: string) => {
      const plan = store.organizationPlan(id),
        group = plan.groups?.find((group) => group.id === groupId);
      const root = group && plan.roots?.[group.rootRef];
      if (!group || !root || !within(root.path, group.destination))
        throw new Error('No approved destination.');
      await allowFolder(root.path);
      await checkPath(group.destination);
      await shell.openPath(group.destination);
    });
    handle('library-index', (root: string, resumeId?: string) =>
      organizationTask('Scanning library', (signal) => locations.index(root, signal, resumeId)),
    );
    handle('library-search', (query: string, scope: string, offset: number) =>
      locations.search(query, scope, offset),
    );
    handle('library-open', (id: string) =>
      locations.openIndexed(id, (folder) => shell.openPath(folder)),
    );
    handle('library-forget', (id: string) => {
      idle();
      locations.forgetScope(id);
    });
    handle(
      'library-collection',
      (input: import('../shared/organize-location').VirtualCollection, remove?: boolean) => {
        idle();
        if (remove !== undefined && typeof remove !== 'boolean')
          throw new Error('Invalid saved search operation.');
        locations.saveCollection(input, remove === true);
      },
    );
    const tidyTimer = setInterval(() => {
      if (
        active ||
        watchers.size ||
        quitting ||
        !store.records<TidyLocation>('tidy').some((item) => item.enabled)
      )
        return;
      void organizationTask('Checking completed arrivals', (signal) =>
        locations.pulse(signal),
      ).catch(() => {});
    }, 15000);
    tidyTimer.unref();
    app.once('before-quit', () => clearInterval(tidyTimer));
    handle('organizer-state', () => ({
      scan: organizationScan,
      plan: organizationPlan,
      progress: organizationProgress,
      history: store.organizationHistory(1),
      presets: organizationPresets(),
    }));
    handle('organizer-clear-cache', () => {
      idle();
      store.db.exec('DELETE FROM organization_ai_cache');
    });
    handle('organizer-scan', (options: ScanOptions) =>
      organizationTask('Scanning', async (signal) => {
        await allowFolder(options.root);
        organizationScan = await scanFiles(options, signal, reportOrganizationProgress);
        store.putOrganizationScan(organizationScan);
        organizationPlan = null;
        store.set('organization-current', '');
      }),
    );
    handle('organizer-resume-scan', () =>
      organizationTask('Scanning next section', async (signal) => {
        if (
          !organizationScan?.options ||
          organizationScan.status !== 'limited' ||
          !organizationScan.pendingFolders?.length
        )
          throw new Error('No unfinished scan section is available. Start a new scan.');
        await allowFolder(organizationScan.root);
        organizationScan = await scanFiles(
          organizationScan.options,
          signal,
          reportOrganizationProgress,
          organizationScan,
        );
        store.putOrganizationScan(organizationScan);
        organizationPlan = null;
        store.set('organization-current', '');
      }),
    );
    handle('organizer-plan', (options: PlanOptions) =>
      organizationTask('Preparing review', (signal) => prepareOrganizationReview(options, signal)),
    );
    handle(
      'organizer-save-preset',
      async (input: Omit<OrganizerPreset, 'id' | 'nextRun'> & { id?: string }) => {
        idle();
        if (
          !input ||
          typeof input.name !== 'string' ||
          !input.name.trim() ||
          input.name.length > 80 ||
          typeof input.enabled !== 'boolean' ||
          !Number.isInteger(input.everyHours) ||
          input.everyHours < 1 ||
          input.everyHours > 8760 ||
          !input.scan ||
          typeof input.scan.recursive !== 'boolean' ||
          !Array.isArray(input.scan.exclude) ||
          input.scan.exclude.some((p) => typeof p !== 'string' || !path.isAbsolute(p)) ||
          !input.options ||
          !organizerTemplates.some((t) => t.id === input.options.template)
        )
          throw new Error(
            'Enter a name, valid folder settings, and an interval from 1 to 8760 hours.',
          );
        if (input.enabled && needsAI(input.options.template))
          throw new Error(
            'AI templates require manual analysis confirmation. Save them without a schedule.',
          );
        await allowFolder(input.scan.root);
        if (input.options.template !== 'rename') await allowFolder(input.options.destination);
        idle();
        const presets = organizationPresets();
        const prior = input.id ? presets.find((p) => p.id === input.id) : undefined;
        if (input.id && !prior) throw new Error('Saved workflow not found.');
        if (!prior && presets.length >= 30)
          throw new Error('Remove a saved workflow before adding more (limit 30).');
        const preset: OrganizerPreset = {
          id: prior?.id || randomUUID(),
          name: input.name.trim(),
          scan: input.scan,
          options: input.options,
          everyHours: input.everyHours,
          enabled: input.enabled,
          nextRun:
            prior?.enabled && prior.everyHours === input.everyHours
              ? prior.nextRun
              : new Date(Date.now() + input.everyHours * 3600000).toISOString(),
          lastRun: prior?.lastRun,
          lastPlanId: prior?.lastPlanId,
          error: prior?.error,
        };
        store.set(
          'organization-presets',
          JSON.stringify([...presets.filter((p) => p.id !== preset.id), preset]),
        );
        update();
      },
    );
    handle('organizer-remove-preset', (id: string) => {
      idle();
      store.set(
        'organization-presets',
        JSON.stringify(organizationPresets().filter((p) => p.id !== id)),
      );
      update();
    });
    handle('organizer-run-preset', async (id: string) => {
      const preset = organizationPresets().find((p) => p.id === id);
      if (!preset) throw new Error('Saved workflow not found.');
      const planId = await runOrganizationPreset(preset);
      const presets = organizationPresets();
      const current = presets.find((p) => p.id === id);
      if (current) {
        current.lastPlanId = planId;
        current.lastRun = new Date().toISOString();
        current.error = undefined;
        store.set('organization-presets', JSON.stringify(presets));
        update();
      }
    });
    const maintenance = new MaintenanceQueue({
      list: organizationPresets,
      save: (presets) => {
        store.set('organization-presets', JSON.stringify(presets));
        update();
      },
      available: () => !active && !watchers.size && !quitting,
      prepare: runOrganizationPreset,
      notify,
    });
    const maintenanceTimer = setInterval(() => {
      void maintenance
        .pulse()
        .catch((error) => notify(`Scheduled review stopped: ${String(error)}`));
    }, 30000);
    maintenanceTimer.unref();
    app.once('before-quit', () => clearInterval(maintenanceTimer));
    handle('organizer-select', (ids: string[]) => {
      idle();
      const plan = organizationPlan;
      if (
        !plan ||
        plan.status !== 'review' ||
        !Array.isArray(ids) ||
        ids.some((id) => typeof id !== 'string')
      )
        throw new Error('Open a review before selecting files.');
      const selected = new Set(ids);
      for (const item of plan.items) item.selected = !item.issue && selected.has(item.id);
      updateDeliveryManifest(plan);
      store.putOrganizationPlan(plan, undefined, true);
      update();
    });
    handle('organizer-apply', () =>
      organizationTask('Confirming changes', async (signal) => {
        const plan = organizationPlan;
        if (!plan || plan.status !== 'review') throw new Error('Create and review a plan first.');
        if (plan.version !== 1) throw new Error('Open this collection in File organizer.');
        await allowFolder(plan.root);
        await allowFolder(plan.options.destination);
        const count = plan.items.filter((i) => i.selected && !i.issue).length;
        if (!count) throw new Error('Select at least one change.');
        const answer = await dialog.showMessageBox(win, {
          type: 'question',
          message: `Apply ${count} reviewed file changes?`,
          detail: `${plan.options.operation === 'move' ? 'Move or rename' : 'Copy'} files from ${plan.root}\nDestination: ${plan.options.destination}\nExisting files will not be overwritten.`,
          buttons: ['Cancel', 'Apply changes'],
          defaultId: 0,
          cancelId: 0,
        });
        if (answer.response !== 1) return;
        signal.throwIfAborted();
        await applyPlan(
          plan,
          signal,
          (p, item) => store.putOrganizationPlan(p, item),
          reportOrganizationProgress,
        );
      }),
    );
    handle('organizer-undo', () =>
      organizationTask('Confirming undo', async (signal) => {
        const plan = organizationPlan;
        if (!plan) throw new Error('Open a recorded batch first.');
        await allowFolder(plan.root);
        await allowFolder(plan.options.destination);
        const answer = await dialog.showMessageBox(win, {
          message: 'Undo this batch?',
          detail:
            'Unchanged copies are removed; moved files are restored. Undo stops if a file changed or its original path is occupied. Created folders remain.',
          buttons: ['Cancel', 'Undo batch'],
          defaultId: 0,
          cancelId: 0,
        });
        if (answer.response !== 1) return;
        signal.throwIfAborted();
        await undoPlan(
          plan,
          signal,
          (p, item) => store.putOrganizationPlan(p, item),
          reportOrganizationProgress,
        );
      }),
    );
    handle('organizer-load', (id: string) => {
      idle();
      organizationPlan = store.organizationPlan(id);
      store.set('organization-current', id);
      update();
    });
    handle('snapshot', () => ({
      workflows: store.workflows(),
      runs: store.runs(),
      watching: [...watchers.keys()],
      settings: settings(),
      cloud: cloudSnapshot(),
      busy: !!active,
    }));
    handle('toolbox-pick', async () => {
      const picked = await dialog.showOpenDialog(win, {
        properties: ['openFile', 'multiSelections'],
      });
      if (picked.canceled) return [];
      const result: string[] = [];
      for (const selected of picked.filePaths.slice(0, 50)) {
        const file = await fs.realpath(selected);
        if (!(await fs.lstat(file)).isFile()) continue;
        files.add(file);
        result.push(file);
      }
      return result;
    });
    handle('toolbox-grant', async (paths: string[]) => {
      if (
        !Array.isArray(paths) ||
        paths.length > 50 ||
        paths.some((p) => typeof p !== 'string' || !path.isAbsolute(p))
      )
        throw new Error('Drop up to 50 regular files.');
      const result: string[] = [];
      for (const candidate of paths) {
        const stat = await fs.lstat(candidate);
        if (!stat.isFile() || stat.isSymbolicLink()) continue;
        const file = await fs.realpath(candidate);
        files.add(file);
        result.push(file);
      }
      return result;
    });
    handle(
      'toolbox-history',
      () => JSON.parse(store.get('toolbox-history') || '[]') as ToolboxResult[],
    );
    handle('toolbox-run', async (input: ToolboxInput) => {
      idle();
      validateToolboxInput(input);
      if (input.paths.some((p) => !files.has(p)))
        throw new Error('Choose or drop the files into Relay first.');
      const controller = new AbortController();
      active = controller;
      update();
      const outputRoot =
        process.env.RELAY_TOOLBOX_OUTPUT_DIR ||
        path.join(app.getPath('documents'), 'Relay Results');
      try {
        const result = await runToolbox(input, outputRoot, controller.signal, (progress) => {
          if (win && !win.isDestroyed()) win.webContents.send('studio:toolbox-progress', progress);
        });
        const history = JSON.parse(store.get('toolbox-history') || '[]') as ToolboxResult[];
        store.set(
          'toolbox-history',
          JSON.stringify([{ ...result, text: undefined }, ...history].slice(0, 30)),
        );
        for (const output of result.outputs) files.add(output.path);
        return result;
      } finally {
        active = null;
        if (win && !win.isDestroyed()) win.webContents.send('studio:toolbox-progress', null);
        update();
        if (closeAfterRun) {
          closeAfterRun = false;
          win.close();
        } else void drain();
      }
    });
    handle('toolbox-preview', async (file: string) => {
      if (typeof file !== 'string' || !files.has(file)) throw new Error('Choose an image first.');
      const stat = await fs.lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 25 * 1024 * 1024)
        throw new Error('This picture is too large to preview.');
      const { createCanvas, loadImage } = await import('@napi-rs/canvas');
      const image = await loadImage(file);
      if (image.width * image.height > 60_000_000)
        throw new Error('This picture is too large to preview.');
      const scale = Math.min(1, 420 / Math.max(image.width, image.height));
      const canvas = createCanvas(
        Math.max(1, Math.round(image.width * scale)),
        Math.max(1, Math.round(image.height * scale)),
      );
      canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/png');
    });
    handle('toolbox-open', async (file: string, reveal: boolean) => {
      if (typeof file !== 'string' || typeof reveal !== 'boolean')
        throw new Error('Choose a result.');
      const history = JSON.parse(store.get('toolbox-history') || '[]') as ToolboxResult[];
      if (!history.some((entry) => entry.outputs.some((output) => output.path === file)))
        throw new Error('This is not a recorded result.');
      if (reveal) shell.showItemInFolder(file);
      else {
        const error = await shell.openPath(file);
        if (error) throw new Error(error);
      }
    });
    handle('toolbox-copy', (value: string) => {
      if (typeof value !== 'string' || value.length > 500000)
        throw new Error('Text is too long to copy.');
      clipboard.writeText(value);
    });
    handle('save', async (w: Workflow) => {
      idle();
      validateWorkflow(w);
      await stopWatching(w.id);
      const saved = store.save(w);
      update();
      return saved;
    });
    handle('remove', async (id: string) => {
      idle();
      const w = store.workflow(id);
      const answer = await dialog.showMessageBox(win, {
        message: `Delete “${w.name}”?`,
        detail: 'Run history will remain available.',
        buttons: ['Cancel', 'Delete'],
        cancelId: 0,
        defaultId: 0,
      });
      if (answer.response !== 1) return false;
      await stopWatching(id);
      store.remove(id);
      update();
      return true;
    });
    handle('folder', async () => {
      const result = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
      if (result.canceled) return null;
      const folder = await fs.realpath(result.filePaths[0]);
      const grants = new Set<string>(JSON.parse(store.get('folders') || '[]'));
      grants.add(folder);
      store.set('folders', JSON.stringify([...grants]));
      return folder;
    });
    handle('file', async () => {
      const result = await dialog.showOpenDialog(win, { properties: ['openFile'] });
      if (result.canceled) return null;
      const file = await fs.realpath(result.filePaths[0]);
      files.add(file);
      return file;
    });
    handle('execute', async (id: string, source: string, preview: boolean) => {
      if (typeof source !== 'string' || typeof preview !== 'boolean' || !files.has(source))
        throw new Error('Choose a sample file using the file picker first.');
      if (watchers.has(id)) throw new Error('Pause watching before a manual run.');
      return startRun(store.workflow(id), source, preview, 'manual');
    });
    handle(
      'execute-folder',
      async (id: string, folder: string, recursive: boolean, preview: boolean) => {
        idle();
        if (
          typeof folder !== 'string' ||
          typeof recursive !== 'boolean' ||
          typeof preview !== 'boolean'
        )
          throw new Error('Invalid folder run.');
        if (watchers.size)
          throw new Error('Pause all watchers before processing an existing folder.');
        const workflow = store.workflow(id);
        validateRunnable(workflow);
        const controller = new AbortController();
        active = controller;
        update();
        try {
          await allowFolder(folder);
          const destinations = workflow.nodes
            .filter((n) => ['copy', 'move', 'write'].includes(n.data.kind))
            .map((n) => n.data.config.folder);
          for (const destination of destinations) await allowFolder(destination);
          const sources = await collectFiles(folder, recursive, destinations);
          if (!sources.length) throw new Error('No files found in this folder.');
          let completed = 0;
          let last: Run | undefined;
          for (const source of sources) {
            if (controller.signal.aborted) break;
            last = await execute(workflow, source, preview, 'manual', {
              signal: controller.signal,
              allowFolder,
              update: (r) => {
                store.putRun(r);
                update();
              },
              ai: (text, config, signal) => transform(settings(), apiKey(), text, config, signal),
              notify,
            });
            completed++;
            const client = cloud();
            if (client) {
              try {
                await client.recordRun(cloudConfig().workspaceId!, last);
              } catch (error) {
                notify(`Cloud sync skipped: ${(error as Error).message}`);
              }
            }
            // A failure may have partial effects: stop for inspection rather than multiply it.
            if (last.status !== 'success') break;
          }
          return { completed, total: sources.length, last };
        } finally {
          active = null;
          update();
          if (closeAfterRun) {
            closeAfterRun = false;
            win.close();
          }
        }
      },
    );
    handle('cancel', () => {
      active?.abort(new Error('Cancelled by user.'));
    });
    handle('watch', async (id: string, enabled: boolean) => {
      idle();
      if (typeof enabled !== 'boolean') throw new Error('Invalid watch state.');
      if (!enabled) return stopWatching(id);
      if (!watchers.has(id)) await enableWatch(store.workflow(id));
    });
    handle('undo', async (id: string) => {
      idle();
      if (watchers.size)
        throw new Error('Pause all folder watchers before undoing file operations.');
      const run = store.run(id);
      const answer = await dialog.showMessageBox(win, {
        message: 'Undo file changes from this run?',
        detail:
          'Created files are removed and moved files are restored only if their contents are unchanged. AI requests and notifications cannot be undone.',
        buttons: ['Cancel', 'Undo file changes'],
        cancelId: 0,
        defaultId: 0,
      });
      if (answer.response !== 1) return;
      active = new AbortController();
      try {
        await undoRun(run, (r) => {
          store.putRun(r);
          update();
        });
      } finally {
        active = null;
        update();
      }
    });
    handle('export', async (id: string) => {
      const result = await dialog.showSaveDialog(win, {
        defaultPath: 'workflow.relay.json',
        filters: [{ name: 'Relay workflow', extensions: ['json'] }],
      });
      if (result.canceled || !result.filePath) return false;
      const w = store.workflow(id);
      for (const n of w.nodes) if ('folder' in n.data.config) n.data.config.folder = '';
      await fs.writeFile(result.filePath, JSON.stringify({ version: 1, workflow: w }, null, 2));
      return true;
    });
    handle('import', async () => {
      idle();
      const result = await dialog.showOpenDialog(win, {
        properties: ['openFile'],
        filters: [{ name: 'Relay workflow', extensions: ['json'] }],
      });
      if (result.canceled) return null;
      if ((await fs.stat(result.filePaths[0])).size > 200000)
        throw new Error('Workflow file is too large.');
      const data = JSON.parse(await fs.readFile(result.filePaths[0], 'utf8'));
      if (data.version !== 1) throw new Error('Unsupported workflow version.');
      const w = validateWorkflow(data.workflow);
      w.id = randomUUID();
      w.name = `${w.name.slice(0, 85)} (imported)`;
      for (const n of w.nodes) if ('folder' in n.data.config) n.data.config.folder = '';
      const saved = store.save(w);
      update();
      return saved;
    });
    handle('settings', (input: AISettings & { apiKey?: string }) => {
      idle();
      validateEndpoint(input);
      const prior = settings();
      if (input.apiKey != null && typeof input.apiKey !== 'string')
        throw new Error('Invalid API key.');
      if (input.apiKey) {
        if (
          !safeStorage.isEncryptionAvailable() ||
          (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')
        )
          throw new Error('Secure credential storage is unavailable on this system.');
        store.set('ai-key', safeStorage.encryptString(input.apiKey).toString('base64'));
      } else if (input.apiKey === '' || prior.endpoint !== input.endpoint) store.set('ai-key', '');
      store.set(
        'ai-settings',
        JSON.stringify({
          provider: input.provider,
          endpoint: input.endpoint,
          model: input.model.trim(),
          allowCloud: input.allowCloud === true,
        }),
      );
      update();
      return settings();
    });
    handle('test-ai', async () => {
      idle();
      return transform(settings(), apiKey(), 'Connection test. Reply with OK.', {
        prompt: 'Reply with OK.',
        format: 'text',
      });
    });
    handle('cloud-settings', () => cloudSnapshot());
    handle(
      'cloud-auth',
      async (input: {
        mode: 'login' | 'register';
        baseUrl: string;
        email: string;
        password: string;
      }) => {
        idle();
        if (!input || !['login', 'register'].includes(input.mode))
          throw new Error('Choose sign in or register.');
        if (
          typeof input.baseUrl !== 'string' ||
          typeof input.email !== 'string' ||
          typeof input.password !== 'string'
        )
          throw new Error('Complete the cloud connection fields.');
        const baseUrl = input.baseUrl.trim().replace(/\/+$/, '');
        if (!baseUrl) throw new Error('Enter a Relay API URL.');
        const client = new RelayCloudClient(baseUrl);
        const session =
          input.mode === 'register'
            ? await client.register(input.email.trim(), input.password)
            : await client.login(input.email.trim(), input.password);
        saveCloudSession(baseUrl, session);
        update();
        return cloudSnapshot();
      },
    );
    handle('cloud-disconnect', () => {
      idle();
      const config = cloudConfig();
      store.set('cloud-token', '');
      store.set('cloud-settings', JSON.stringify({ baseUrl: config.baseUrl }));
      cloudClient = null;
      update();
    });
    handle('cloud-push', async (id: string) => {
      idle();
      const client = cloud();
      if (!client) throw new Error('Connect a Relay workspace first.');
      const config = cloudConfig();
      await client.saveWorkflow(config.workspaceId!, store.workflow(id));
      update();
    });
    handle('cloud-pull', async () => {
      idle();
      const client = cloud();
      if (!client) throw new Error('Connect a Relay workspace first.');
      const config = cloudConfig();
      const entries = await client.workflows(config.workspaceId!);
      for (const entry of entries) store.save(entry.workflow);
      update();
      return store.workflows();
    });
    handle('cloud-share', async (id: string) => {
      idle();
      const client = cloud();
      if (!client) throw new Error('Connect a Relay workspace first.');
      const config = cloudConfig();
      const shared = await client.shareWorkflow(config.workspaceId!, id);
      return `${config.baseUrl}/api/shared/${shared.token}`;
    });
  });
  app.on('window-all-closed', () => app.quit());
}
