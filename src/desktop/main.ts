import { app, BrowserWindow, dialog, ipcMain, Notification, safeStorage } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import type { FSWatcher } from 'chokidar';
import { Store } from './database';
import { RelayCloudClient, type CloudSession } from './cloud';
import { execute, undoRun } from './engine';
import { validateRunnable, validateWorkflow } from './validation';
import { transform, validateEndpoint } from './ai';
import type { AISettings, CloudSettings, Run, Workflow } from '../shared/types';
if (process.env.RELAY_DATA_DIR && !app.isPackaged)
  app.setPath('userData', process.env.RELAY_DATA_DIR);
let win: BrowserWindow,
  store: Store,
  active: AbortController | null = null,
  quitting = false,
  closeAfterRun = false,
  cloudClient: RelayCloudClient | null = null;
const watchers = new Map<string, FSWatcher>();
const queue: { workflow: Workflow; source: string }[] = [];
const files = new Set<string>();
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
    } catch (error) {
      dialog.showErrorBox('Unable to open workspace', String(error));
      app.quit();
      return;
    }
    createWindow();
    handle('snapshot', () => ({
      workflows: store.workflows(),
      runs: store.runs(),
      watching: [...watchers.keys()],
      settings: settings(),
      cloud: cloudSnapshot(),
      busy: !!active,
    }));
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
