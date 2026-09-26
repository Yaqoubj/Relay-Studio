import fs from 'node:fs/promises';
import { createReadStream, constants } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { safeName } from './validation';
import {
  assertSafeDirectory,
  assertSafeToReorganize,
  createPolicyContext,
  hasManagedExtension,
  hasManagedName,
  isManagedDirectory,
} from './file-policy';
import { planSmart } from './smart-organizer';
import { fileCategories, organizerTemplates } from '../shared/organizer';
import {
  analyzeCollection,
  updateDeliveryManifest,
  type AnalysisServices,
} from './collection-analysis';
import type {
  FileCategory,
  FileStamp,
  ScanOptions,
  ScanResult,
  PlanOptions,
  OrganizationPlan,
  OrganizerProgress,
} from '../shared/organizer';

const protectedNames = new Set([
  'windows',
  'program files',
  'program files (x86)',
  'programdata',
  'appdata',
  '$recycle.bin',
  'system volume information',
  'recovery',
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  '.venv',
  'venv',
  'vendor',
  'library',
  'applications',
  'bin',
  'sbin',
  'proc',
  'sys',
  'dev',
  'etc',
]);
if (process.platform === 'win32') protectedNames.delete('library');
const projectMarkers = [
  '.git',
  '.svn',
  '.hg',
  'package.json',
  'pyproject.toml',
  'Cargo.toml',
  'go.mod',
  'composer.json',
  '.relay-preserve',
];
const extensions: Record<string, FileCategory> = {};
for (const [category, list] of Object.entries({
  Documents: 'pdf doc docx odt txt md rtf csv xls xlsx ppt pptx epub',
  Photos: 'jpg jpeg png webp heic heif tiff tif gif bmp dng cr2 nef arw',
  Videos: 'mp4 mov mkv avi webm m4v mts',
  Audio: 'mp3 wav flac aac m4a ogg',
  Archives: 'zip 7z rar tar gz bz2 xz',
  Installers: 'exe msi msix dmg pkg iso',
}))
  for (const ext of list.split(' ')) extensions['.' + ext] = category as FileCategory;
export const categoryOf = (file: string): FileCategory =>
  extensions[path.extname(file).toLowerCase()] || 'Other';
const key = (p: string) =>
  process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p);
export function within(root: string, target: string) {
  const relative = path.relative(key(root), key(target));
  return (
    relative === '' ||
    (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))
  );
}
const protectedPath = (p: string) =>
  path
    .resolve(p)
    .split(/[\\/]/)
    .some(
      (s) =>
        protectedNames.has(s.toLowerCase()) ||
        s.startsWith('.') ||
        /^(?:boot|bootmgr|bootnxt|pagefile\.sys|hiberfil\.sys|swapfile\.sys|ntuser\.dat.*)$/i.test(
          s,
        ),
    );
export const stampOf = (s: {
  size: number;
  mtimeMs: number;
  dev: number;
  ino: number;
}): FileStamp => ({ size: s.size, mtimeMs: s.mtimeMs, dev: s.dev, ino: s.ino });
const sameStamp = (a: FileStamp, b: FileStamp) =>
  a.size === b.size && a.mtimeMs === b.mtimeMs && a.dev === b.dev && a.ino === b.ino;
async function exists(p: string) {
  try {
    await fs.lstat(p);
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw e;
  }
}
// Refuse links/junctions in any existing ancestor, including replacements since scan.
export async function checkPath(p: string, missing = false) {
  const absolute = path.resolve(p);
  let current = path.parse(absolute).root;
  for (const segment of absolute.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try {
      if ((await fs.lstat(current)).isSymbolicLink())
        throw new Error(`Linked path is excluded: ${current}`);
    } catch (e) {
      if (missing && (e as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw e;
    }
  }
}
async function isProject(folder: string) {
  for (const marker of projectMarkers) if (await exists(path.join(folder, marker))) return true;
  return false;
}
export async function scanFiles(
  options: ScanOptions,
  signal: AbortSignal,
  progress: (p: OrganizerProgress) => void,
  resume?: ScanResult,
): Promise<ScanResult> {
  if (
    !options ||
    typeof options.root !== 'string' ||
    !path.isAbsolute(options.root) ||
    typeof options.recursive !== 'boolean' ||
    !Array.isArray(options.exclude) ||
    options.exclude.some((p) => typeof p !== 'string' || !path.isAbsolute(p))
  )
    throw new Error('Choose a folder and valid exclusions.');
  await checkPath(options.root);
  const root = await fs.realpath(options.root);
  await assertSafeDirectory(root);
  if (protectedPath(root) || hasManagedName(root) || (await isManagedDirectory(root)))
    throw new Error(
      'System and application folders cannot be scanned for organization. Choose a personal folder or data drive.',
    );
  if (!(await fs.stat(root)).isDirectory()) throw new Error('Choose a folder.');
  if (
    resume &&
    (resume.status !== 'limited' ||
      resume.root !== root ||
      JSON.stringify(resume.options) !== JSON.stringify({ ...options, root }) ||
      !Array.isArray(resume.pendingFolders) ||
      !resume.pendingFolders.length)
  )
    throw new Error('The saved scan cannot be continued with these settings. Start a new scan.');
  const scan: ScanResult = {
    version: 1,
    id: randomUUID(),
    root,
    createdAt: new Date().toISOString(),
    options: { ...options, root },
    files: [],
    bytes: 0,
    skipped: 0,
    warnings: [],
    status: 'complete',
  };
  const pending = resume ? [...resume.pendingFolders!] : [root];
  const warn = (message: string) => {
    scan.skipped++;
    if (scan.warnings.length < 100) scan.warnings.push(message);
  };
  let visited = 0;
  while (pending.length) {
    if (signal.aborted) {
      scan.status = 'cancelled';
      break;
    }
    const folder = pending.pop()!;
    if (options.exclude.some((p) => within(p, folder))) {
      warn(`Excluded folder: ${folder}`);
      continue;
    }
    try {
      await checkPath(folder);
      if ((await isProject(folder)) || (await isManagedDirectory(folder))) {
        warn(`Application, game, or project folder preserved: ${folder}`);
        continue;
      }
      const dir = await fs.opendir(folder);
      for await (const entry of dir) {
        if (signal.aborted) {
          scan.status = 'cancelled';
          break;
        }
        const full = path.join(folder, entry.name);
        visited++;
        if (
          entry.isSymbolicLink() ||
          protectedPath(full) ||
          options.exclude.some((p) => within(p, full))
        ) {
          warn(`Excluded: ${full}`);
          continue;
        }
        if (entry.isDirectory()) {
          if (options.recursive) pending.push(full);
          continue;
        }
        if (!entry.isFile()) continue;
        if (hasManagedExtension(full)) {
          warn(`Application or game data preserved: ${full}`);
          continue;
        }
        try {
          const stat = await fs.lstat(full);
          if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1) {
            warn(`Linked file preserved: ${full}`);
            continue;
          }
          scan.files.push({
            id: randomUUID(),
            path: full,
            relative: path.relative(root, full),
            category: categoryOf(full),
            ...stampOf(stat),
          });
          scan.bytes += stat.size;
        } catch (e) {
          warn(`${full}: ${(e as Error).message}`);
        }
        if (visited % 100 === 0)
          progress({ stage: 'Scanning', count: scan.files.length, path: folder });
      }
    } catch (e) {
      warn(`${folder}: ${(e as Error).message}`);
    }
    progress({ stage: 'Scanning', count: scan.files.length, path: folder });
    if (
      scan.status === 'complete' &&
      pending.length &&
      (visited >= 200000 || scan.files.length >= 50000)
    )
      scan.status = 'limited';
    if (scan.status !== 'complete') break;
  }
  if (pending.length) scan.pendingFolders = pending;
  scan.files.sort((a, b) => a.relative.localeCompare(b.relative));
  return scan;
}
export async function buildPlan(
  scan: ScanResult,
  options: PlanOptions,
  signal: AbortSignal,
  services: AnalysisServices = {},
): Promise<OrganizationPlan> {
  if (
    !options ||
    !organizerTemplates.some((template) => template.id === options.template) ||
    !['copy', 'move'].includes(options.operation) ||
    typeof options.preserveStructure !== 'boolean' ||
    !Array.isArray(options.categories) ||
    options.categories.some((c) => !fileCategories.includes(c)) ||
    typeof options.pattern !== 'string' ||
    options.pattern.length > 180 ||
    !Array.isArray(options.exclude) ||
    options.exclude.some((p) => typeof p !== 'string' || !path.isAbsolute(p))
  )
    throw new Error('Invalid organization rules.');
  if (
    ['smart', 'smart-ai', 'combine'].includes(options.template) &&
    ((options.placement !== undefined &&
      !['inside', 'subfolder', 'elsewhere'].includes(options.placement)) ||
      (options.renameSmart !== undefined && typeof options.renameSmart !== 'boolean') ||
      (options.template === 'smart-ai' &&
        (!Number.isFinite(options.maxAIRequests) ||
          (options.maxAIRequests ?? 0) < 1 ||
          (options.maxAIRequests ?? 0) > 100 ||
          !Number.isFinite(options.maxCharacters) ||
          (options.maxCharacters ?? 0) < 500 ||
          (options.maxCharacters ?? 0) > 60000 ||
          !Number.isFinite(options.minConfidence) ||
          (options.minConfidence ?? -1) < 0 ||
          (options.minConfidence ?? 2) > 1)))
  )
    throw new Error('Choose valid smart organization and AI limits.');
  if (
    scan.status !== 'complete' &&
    !(scan.status === 'limited' && ['smart', 'smart-ai', 'combine'].includes(options.template))
  )
    throw new Error(
      'Finish a complete scan before creating a plan. Choose a smaller folder if the scan reached its limit.',
    );
  const smart = ['smart', 'smart-ai', 'combine'].includes(options.template);
  const destination = smart
    ? options.placement === 'elsewhere'
      ? await fs.realpath(options.destination)
      : options.placement === 'subfolder'
        ? path.join(scan.root, safeName(options.subfolderName?.trim() || 'Organized'))
        : scan.root
    : options.template === 'rename'
      ? scan.root
      : await fs.realpath(options.destination);
  await checkPath(destination, smart && options.placement === 'subfolder');
  await assertSafeDirectory(destination);
  if (protectedPath(destination)) throw new Error('Choose a personal output folder.');
  if (smart && options.placement === 'elsewhere' && within(destination, scan.root))
    throw new Error('Choose an output folder outside the source and its parents.');
  if (!smart && options.template !== 'rename' && within(destination, scan.root))
    throw new Error('Choose a separate output folder, not the input folder or one of its parents.');
  const plan: OrganizationPlan = {
    version: 1,
    id: randomUUID(),
    scanId: scan.id,
    root: scan.root,
    createdAt: new Date().toISOString(),
    options: {
      ...options,
      destination,
      operation:
        smart || options.template === 'rename'
          ? 'move'
          : [
                'delivery',
                'backup',
                'ai-receipts',
                'ai-meetings',
                'ai-research',
                'ai-adviser',
              ].includes(options.template)
            ? 'copy'
            : options.operation,
    },
    items: [],
    status: 'review',
  };
  if (scan.status === 'limited')
    plan.notes = [
      `Partial scan: this review covers ${scan.files.length.toLocaleString()} files. ${scan.pendingFolders?.length || 0} folders remain. Continue the scan after reviewing this batch.`,
    ];
  const candidates = scan.files.filter(
    (file) =>
      options.categories.includes(file.category) &&
      !options.exclude.some((p) => within(p, file.path)) &&
      (smart || options.template === 'rename' || !within(destination, file.path)),
  );
  let number = 0;
  for (const file of ['drive', 'downloads', 'rename'].includes(options.template)
    ? candidates
    : []) {
    signal.throwIfAborted();
    if (
      !options.categories.includes(file.category) ||
      options.exclude.some((p) => within(p, file.path)) ||
      (options.template !== 'rename' && within(destination, file.path))
    )
      continue;
    number++;
    const parsed = path.parse(file.path);
    const date = new Date(file.mtimeMs).toISOString().slice(0, 10);
    let target: string;
    if (options.template === 'rename') {
      const vars: Record<string, string> = {
        stem: parsed.name,
        ext: parsed.ext,
        name: parsed.base,
        date,
        number: String(number).padStart(4, '0'),
      };
      const name = safeName(
        options.pattern.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, variable: string) => {
          if (!Object.hasOwn(vars, variable))
            throw new Error(`Unknown rename variable: ${variable}`);
          return vars[variable];
        }),
      );
      target = path.join(parsed.dir, name);
    } else {
      const structure = options.preserveStructure ? path.dirname(file.relative) : '';
      target = path.join(
        destination,
        file.category,
        options.template === 'downloads' ? date.slice(0, 7) : '',
        structure,
        parsed.base,
      );
    }
    if (key(target) === key(file.path)) continue;
    const item: (typeof plan.items)[number] = {
      id: file.id,
      source: file.path,
      destination: target,
      stamp: stampOf(file),
      reason:
        options.template === 'rename'
          ? `Rename pattern · modified ${date}`
          : `${file.category} · ${parsed.ext || 'unknown extension'}${options.template === 'downloads' ? ` · modified ${date.slice(0, 7)}` : ''}`,
      selected: true,
      state: 'pending',
    };
    plan.items.push(item);
  }
  if (smart) await planSmart(plan, candidates, signal, services);
  else if (options.template === 'cleanup') {
    const duplicatePlan: OrganizationPlan = {
      ...plan,
      options: { ...plan.options, template: 'duplicates' },
      items: [],
      notes: [],
    };
    await analyzeCollection(duplicatePlan, candidates, signal, services);
    const duplicateSources = new Set(duplicatePlan.items.map((item) => key(item.source)));
    const keepers = new Set(
      duplicatePlan.items.flatMap((item) => (item.keeper ? [key(item.keeper.path)] : [])),
    );
    const storagePlan: OrganizationPlan = {
      ...plan,
      options: { ...plan.options, template: 'storage' },
      items: [],
      notes: [],
    };
    await analyzeCollection(
      storagePlan,
      candidates.filter(
        (file) => !duplicateSources.has(key(file.path)) && !keepers.has(key(file.path)),
      ),
      signal,
      services,
    );
    for (const item of duplicatePlan.items) item.group = 'Exact duplicates';
    for (const item of storagePlan.items) item.group = 'Large old files';
    plan.items.push(...duplicatePlan.items, ...storagePlan.items);
    plan.notes = [...(duplicatePlan.notes || []), ...(storagePlan.notes || [])];
  } else if (!['drive', 'downloads', 'rename'].includes(options.template))
    await analyzeCollection(plan, candidates, signal, services);
  updateDeliveryManifest(plan);
  const targets = new Map<string, (typeof plan.items)[number]>();
  for (const item of plan.items) {
    signal.throwIfAborted();
    if (!within(destination, item.destination) || protectedPath(item.destination))
      throw new Error(
        'A proposed output is outside the allowed destination or uses a protected name.',
      );
    try {
      await checkPath(item.destination, true);
      if (await exists(item.destination)) item.issue ||= 'Destination already exists';
    } catch (e) {
      item.issue = (e as Error).message;
    }
    const duplicate = targets.get(key(item.destination));
    if (duplicate) {
      duplicate.issue = item.issue = 'Two files would use this destination';
      duplicate.selected = false;
    }
    targets.set(key(item.destination), item);
    if (item.issue) item.selected = false;
  }
  updateDeliveryManifest(plan);
  return plan;
}
export async function hashFile(file: string, signal?: AbortSignal) {
  const hash = createHash('sha256');
  const stream = createReadStream(file, { signal });
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest('hex');
}
export async function verifySource(
  item: Pick<OrganizationPlan['items'][number], 'source' | 'stamp'>,
) {
  await checkPath(item.source);
  const stat = await fs.lstat(item.source);
  if (!stat.isFile() || stat.nlink > 1 || !sameStamp(item.stamp, stampOf(stat)))
    throw new Error('Source changed since the scan. Scan again before applying changes.');
}
async function verifyKeeper(item: OrganizationPlan['items'][number], signal: AbortSignal) {
  if (!item.keeper) return;
  await verifySource({ source: item.keeper.path, stamp: item.keeper.stamp });
  if ((await hashFile(item.keeper.path, signal)) !== item.keeper.hash)
    throw new Error('The retained duplicate changed. Scan and compare again.');
  await verifySource({ source: item.keeper.path, stamp: item.keeper.stamp });
}
type Save = (plan: OrganizationPlan, item?: OrganizationPlan['items'][number]) => void;
async function makeTrackedFolders(folder: string, plan: OrganizationPlan, save: Save) {
  const missing: string[] = [];
  let current = folder;
  while (!(await exists(current))) {
    missing.push(current);
    const parent = path.dirname(current);
    if (parent === current) throw new Error('Cannot create the destination root.');
    current = parent;
  }
  for (const target of missing.reverse()) {
    await checkPath(target, true);
    try {
      await fs.mkdir(target);
      (plan.createdFolders ||= []).push(target);
      save(plan);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
}
export async function applyPlan(
  plan: OrganizationPlan,
  signal: AbortSignal,
  save: Save,
  progress: (p: OrganizerProgress) => void,
) {
  if (![1, 2].includes(plan.version) || plan.status !== 'review')
    throw new Error('Only a reviewed, unexecuted plan can be applied.');
  const items = plan.items.filter((i) => i.selected && !i.issue);
  const policy = createPolicyContext();
  if (plan.version === 2) {
    for (const item of items)
      if (
        plan.items.some((other) => other.setId === item.setId && (!other.selected || other.issue))
      )
        throw new Error('Related files must be selected together.');
    await validatePlanRoots(plan, policy);
    await verifyBundles(plan, items, signal);
  }
  if (!items.length) throw new Error('Select at least one conflict-free change.');
  plan.status = 'running';
  save(plan);
  try {
    // Recheck the whole approved plan before touching any file.
    let checked = 0;
    for (const item of items) {
      signal.throwIfAborted();
      if ((item.action || plan.options.operation) === 'move')
        await assertSafeToReorganize(item.source, policy);
      await verifySource(item);
      if (item.sourceHash && (await hashFile(item.source, signal)) !== item.sourceHash)
        throw new Error('Source contents changed since analysis. Build a fresh review.');
      await verifyKeeper(item, signal);
      if (!within(plan.root, item.source) || !within(destinationRoot(plan, item), item.destination))
        throw new Error('File is outside the approved folders.');
      await assertSafeDirectory(path.dirname(item.destination), policy);
      await checkPath(item.destination, true);
      if (await exists(item.destination))
        throw new Error(`Destination exists: ${item.destination}`);
      if (++checked % 100 === 0)
        progress({ stage: 'Checking reviewed files', count: checked, total: items.length });
    }
    let count = 0;
    for (const item of items) {
      signal.throwIfAborted();
      progress({ stage: 'Applying changes', count, total: items.length, path: item.source });
      try {
        await verifySource(item);
        if ((item.action || plan.options.operation) === 'move')
          await assertSafeToReorganize(item.source, policy);
        const sourceHash = await hashFile(item.source, signal);
        if (item.sourceHash && sourceHash !== item.sourceHash)
          throw new Error('Source contents changed since analysis. Build a fresh review.');
        item.hash =
          item.action === 'write'
            ? createHash('sha256')
                .update(item.content || '')
                .digest('hex')
            : sourceHash;
        await verifyKeeper(item, signal);
        await verifySource(item);
        signal.throwIfAborted();
        await checkPath(item.destination, true);
        if (plan.version === 2) await validatePlanRoots(plan, policy);
        await assertSafeDirectory(path.dirname(item.destination), policy);
        await makeTrackedFolders(path.dirname(item.destination), plan, save);
        await checkPath(item.destination, true);
        if (await exists(item.destination))
          throw new Error('Destination appeared after review. Nothing was overwritten.');
        item.state = 'copying';
        save(plan, item);
        if (item.action === 'write')
          await fs.writeFile(item.destination, item.content || '', { flag: 'wx' });
        else {
          await fs.copyFile(item.source, item.destination, constants.COPYFILE_EXCL);
          await fs.utimes(item.destination, new Date(), new Date(item.stamp.mtimeMs));
        }
        item.state = 'copied';
        save(plan, item);
        if ((await hashFile(item.destination)) !== item.hash)
          throw new Error('Copy verification failed. Source retained.');
        await verifySource(item);
        if ((item.action || plan.options.operation) === 'move') {
          if ((await hashFile(item.source)) !== item.hash)
            throw new Error('Source changed during copying. Both copies retained.');
          item.state = 'removing';
          save(plan, item);
          await fs.unlink(item.source);
        }
        item.state = 'done';
        save(plan, item);
        count++;
      } catch (e) {
        item.error = (e as Error).message;
        if (item.state === 'pending') item.state = 'failed';
        save(plan, item);
        throw e;
      }
    }
    for (const bundle of plan.bundles || []) {
      if (!items.some((item) => item.bundleId === bundle.id)) continue;
      for (const directory of bundle.directories) {
        const relative = path.relative(bundle.source, directory.path);
        await makeTrackedFolders(path.join(bundle.destination, relative), plan, save);
      }
      for (const directory of [...bundle.directories].reverse()) {
        await checkPath(directory.path);
        const stat = await fs.lstat(directory.path);
        if (stat.dev !== directory.dev || stat.ino !== directory.ino)
          throw new Error(
            'A collection folder changed during the move. Remaining folders retained.',
          );
        const folderEntry = { path: directory.path, state: 'removing' as const };
        (plan.folderJournal ||= []).push(folderEntry);
        save(plan);
        await fs.rmdir(directory.path); // Never recursively delete: new arrivals keep the folder.
        plan.folderJournal![plan.folderJournal!.length - 1].state = 'removed';
        (plan.removedFolders ||= []).push(directory.path);
        save(plan);
      }
    }
    plan.status = 'complete';
  } catch (e) {
    plan.status = signal.aborted ? 'cancelled' : 'failed';
    plan.error = (e as Error).message;
  }
  save(plan);
}
export async function undoPlan(
  plan: OrganizationPlan,
  signal: AbortSignal,
  save: Save,
  progress: (p: OrganizerProgress) => void,
) {
  if (![1, 2].includes(plan.version)) throw new Error('Unsupported plan version.');
  if (plan.version === 2) await validatePlanRoots(plan);
  if (['review', 'running', 'undoing', 'undone'].includes(plan.status))
    throw new Error('This plan cannot be undone now.');
  // Uncertain crash windows require inspection; never guess ownership of a file.
  if (
    plan.items.some((i) =>
      ['copying', 'removing', 'restoring', 'undo-removing'].includes(i.state),
    ) ||
    plan.folderJournal?.some((entry) => ['removing', 'restoring'].includes(entry.state))
  )
    throw new Error(
      'An interrupted operation needs manual inspection. Check the journal paths before changing either copy.',
    );
  plan.status = 'undoing';
  plan.error = undefined;
  save(plan);
  try {
    const items = [...plan.items]
      .reverse()
      .filter((i) => ['done', 'copied', 'restored'].includes(i.state));
    let count = 0;
    for (const item of items) {
      signal.throwIfAborted();
      if (!within(plan.root, item.source) || !within(destinationRoot(plan, item), item.destination))
        throw new Error('Undo path is outside the recorded roots.');
      await assertSafeDirectory(path.dirname(item.source));
      await assertSafeDirectory(path.dirname(item.destination));
      progress({ stage: 'Undoing changes', count, total: items.length, path: item.destination });
      await checkPath(item.destination);
      if (!item.hash || (await hashFile(item.destination, signal)) !== item.hash)
        throw new Error(`File changed; undo stopped: ${item.destination}`);
      if ((item.action || plan.options.operation) === 'move' && item.state === 'done') {
        await checkPath(item.source, true);
        if (await exists(item.source)) throw new Error(`Original path is occupied: ${item.source}`);
        await fs.mkdir(path.dirname(item.source), { recursive: true });
        await checkPath(item.source, true);
        item.state = 'restoring';
        save(plan, item);
        await fs.copyFile(item.destination, item.source, constants.COPYFILE_EXCL);
        await fs.utimes(item.source, new Date(), new Date(item.stamp.mtimeMs));
        if ((await hashFile(item.source)) !== item.hash)
          throw new Error('Restored copy verification failed; both files retained.');
        item.state = 'restored';
        save(plan, item);
      }
      if (item.state === 'restored') {
        await checkPath(item.source);
        if ((await hashFile(item.source)) !== item.hash)
          throw new Error('Restored source changed; both files retained.');
      }
      await checkPath(item.destination);
      if ((await hashFile(item.destination)) !== item.hash)
        throw new Error('Destination changed during undo; both files retained.');
      item.state = 'undo-removing';
      save(plan, item);
      await fs.unlink(item.destination);
      item.state = 'undone';
      save(plan, item);
      count++;
    }
    for (const folder of [...(plan.removedFolders || [])].reverse()) {
      if (!within(plan.root, folder))
        throw new Error('Recorded source folder is outside the root.');
      await checkPath(folder, true);
      const entry = plan.folderJournal?.find((entry) => entry.path === folder);
      if (entry) {
        entry.state = 'restoring';
        save(plan);
      }
      await fs.mkdir(folder, { recursive: true });
      if (entry) {
        entry.state = 'restored';
        save(plan);
      }
    }
    for (const folder of [...new Set(plan.createdFolders || [])].reverse()) {
      if (
        !Object.values(plan.roots || { legacy: { path: plan.options.destination } }).some((root) =>
          within(root.path, folder),
        )
      )
        throw new Error('Recorded folder is outside the destination roots.');
      try {
        await checkPath(folder);
        await fs.rmdir(folder);
      } catch (error) {
        if (
          !['ENOTEMPTY', 'EEXIST', 'ENOENT'].includes((error as NodeJS.ErrnoException).code || '')
        )
          throw error;
      }
    }
    plan.status = 'undone';
  } catch (e) {
    plan.status = signal.aborted ? 'cancelled' : 'failed';
    plan.error = (e as Error).message;
  }
  save(plan);
}

export function destinationRoot(plan: OrganizationPlan, item: OrganizationPlan['items'][number]) {
  if (plan.version === 1) return plan.options.destination;
  const root = item.rootRef && plan.roots?.[item.rootRef];
  if (!root) throw new Error('Unknown destination root reference.');
  return root.path;
}

export async function validatePlanRoots(plan: OrganizationPlan, policy = createPolicyContext()) {
  if (!plan.roots || !Object.keys(plan.roots).length) throw new Error('Missing approved roots.');
  for (const root of Object.values(plan.roots)) {
    await checkPath(root.path);
    const stat = await fs.lstat(root.path);
    if (!stat.isDirectory() || stat.dev !== root.dev || stat.ino !== root.ino)
      throw new Error('A library was disconnected or replaced. Prepare a new review.');
    await assertSafeDirectory(root.path, policy);
  }
}

async function verifyBundles(
  plan: OrganizationPlan,
  items: OrganizationPlan['items'],
  signal: AbortSignal,
) {
  for (const bundle of plan.bundles || []) {
    if (!items.some((item) => item.bundleId === bundle.id)) continue;
    const approved = plan.roots?.[bundle.rootRef];
    if (
      !approved ||
      !within(plan.root, bundle.source) ||
      !within(approved.path, bundle.destination) ||
      within(bundle.source, bundle.destination) ||
      within(bundle.destination, bundle.source)
    )
      throw new Error('Collection is outside approved roots.');
    await checkPath(bundle.destination, true);
    if (await exists(bundle.destination))
      throw new Error('Collection destination appeared after review. Nothing was merged.');
    const expected = new Set([
      ...bundle.files.map((file) => file.path),
      ...bundle.directories.slice(1).map((dir) => dir.path),
    ]);
    for (const dir of bundle.directories) {
      if (!within(bundle.source, dir.path)) throw new Error('Invalid collection directory.');
      signal.throwIfAborted();
      await checkPath(dir.path);
      const stat = await fs.lstat(dir.path);
      if (stat.dev !== dir.dev || stat.ino !== dir.ino)
        throw new Error('Collection folder changed since review.');
      for (const name of await fs.readdir(dir.path))
        if (!expected.has(path.join(dir.path, name)))
          throw new Error('Collection contents changed since review.');
    }
    for (const file of bundle.files) {
      if (!within(bundle.source, file.path)) throw new Error('Invalid collection member.');
      await verifySource({ source: file.path, stamp: file.stamp });
      if ((await hashFile(file.path, signal)) !== file.hash)
        throw new Error('Collection contents changed since review.');
    }
  }
}
