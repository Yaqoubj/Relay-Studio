import fs from 'node:fs/promises';
import path from 'node:path';

// Names that commonly hold files whose relationships another program controls.
const managedNames = new Set([
  'saved games',
  'my games',
  'steamapps',
  'userdata',
  'game saves',
  'savegames',
  'saves',
  'games',
  'mods',
  'mod organizer',
]);
const managedExtensions = new Set(['.sav', '.save', '.ess', '.dat', '.vdf', '.acf']);
const projectMarkers = new Set([
  '.git', '.svn', '.hg', 'package.json', 'pyproject.toml', 'cargo.toml', 'go.mod',
  'composer.json', '.relay-preserve',
]);

export function hasManagedName(target: string) {
  return path.resolve(target).split(/[\\/]/).some((part) => managedNames.has(part.toLowerCase()));
}

export function hasManagedExtension(target: string) {
  return managedExtensions.has(path.extname(target).toLowerCase());
}

export async function isManagedDirectory(folder: string) {
  if (hasManagedName(folder)) return true;
  let names: string[];
  try {
    names = await fs.readdir(folder);
  } catch {
    // Let the caller's normal filesystem error report unreadable directories.
    return false;
  }
  const lower = new Set(names.map((name) => name.toLowerCase()));
  if (names.some((name) => projectMarkers.has(name.toLowerCase()))) return true;
  if (names.some((name) => ['.sav', '.save', '.ess'].includes(path.extname(name).toLowerCase()))) return true;
  // A portable application commonly lives beside its own DLLs.
  if (names.some((name) => name.toLowerCase().endsWith('.exe')) &&
      names.some((name) => name.toLowerCase().endsWith('.dll'))) return true;
  return lower.has('steam_api.dll') || lower.has('steam_api64.dll');
}

export async function assertSafeToReorganize(source: string) {
  if (hasManagedName(source) || hasManagedExtension(source))
    throw new Error('This file looks like application or game data. Relay left it unchanged.');
  let folder = path.dirname(path.resolve(source));
  for (let depth = 0; depth < 2; depth++) {
    if (await isManagedDirectory(folder))
      throw new Error('This file belongs to a project, application, or game folder. Relay left it unchanged.');
    const parent = path.dirname(folder);
    if (parent === folder) break;
    folder = parent;
  }
}
