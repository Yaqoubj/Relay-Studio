import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { StudioAPI } from '../shared/types';
const api: StudioAPI = {
  locationState: () => ipcRenderer.invoke('studio:location-state'),
  locationPick: (known) => ipcRenderer.invoke('studio:location-pick', known),
  locationPrepare: (input) => ipcRenderer.invoke('studio:location-prepare', input),
  locationChoose: (input) => ipcRenderer.invoke('studio:location-choose', input),
  locationApply: (id, revision) => ipcRenderer.invoke('studio:location-apply', id, revision),
  locationUndo: (id) => ipcRenderer.invoke('studio:location-undo', id),
  locationLoad: (id) => ipcRenderer.invoke('studio:location-load', id),
  locationDetails: (id, offset) => ipcRenderer.invoke('studio:location-details', id, offset),
  locationFolders: (root) => ipcRenderer.invoke('studio:location-folders', root),
  locationPreview: (id, fileId) => ipcRenderer.invoke('studio:location-preview', id, fileId),
  locationOpen: (id, groupId) => ipcRenderer.invoke('studio:location-open', id, groupId),
  locationRule: (rule, remove) => ipcRenderer.invoke('studio:location-rule', rule, remove),
  locationTidy: (root, enabled) => ipcRenderer.invoke('studio:location-tidy', root, enabled),
  libraryIndex: (root, resumeId) => ipcRenderer.invoke('studio:library-index', root, resumeId),
  librarySearch: (query, scope, offset) =>
    ipcRenderer.invoke('studio:library-search', query, scope, offset),
  libraryOpen: (id) => ipcRenderer.invoke('studio:library-open', id),
  libraryForget: (id) => ipcRenderer.invoke('studio:library-forget', id),
  libraryCollection: (input, remove) =>
    ipcRenderer.invoke('studio:library-collection', input, remove),
  toolboxPick: () => ipcRenderer.invoke('studio:toolbox-pick'),
  toolboxDropped: (files) =>
    ipcRenderer.invoke(
      'studio:toolbox-grant',
      files.map((file) => webUtils.getPathForFile(file)).filter(Boolean),
    ),
  toolboxRun: (input) => ipcRenderer.invoke('studio:toolbox-run', input),
  toolboxHistory: () => ipcRenderer.invoke('studio:toolbox-history'),
  toolboxPreview: (file) => ipcRenderer.invoke('studio:toolbox-preview', file),
  toolboxOpen: (file, reveal) => ipcRenderer.invoke('studio:toolbox-open', file, reveal),
  toolboxCopy: (value) => ipcRenderer.invoke('studio:toolbox-copy', value),
  onToolboxProgress: (callback) => {
    const listener = (_event: unknown, progress: Parameters<typeof callback>[0]) =>
      callback(progress);
    ipcRenderer.on('studio:toolbox-progress', listener);
    return () => ipcRenderer.removeListener('studio:toolbox-progress', listener);
  },
  organizerState: () => ipcRenderer.invoke('studio:organizer-state'),
  onOrganizerProgress: (callback) => {
    const listener = (_event: unknown, progress: Parameters<typeof callback>[0]) =>
      callback(progress);
    ipcRenderer.on('studio:organizer-progress', listener);
    return () => ipcRenderer.removeListener('studio:organizer-progress', listener);
  },
  organizerScan: (options) => ipcRenderer.invoke('studio:organizer-scan', options),
  organizerResumeScan: () => ipcRenderer.invoke('studio:organizer-resume-scan'),
  organizerPlan: (options) => ipcRenderer.invoke('studio:organizer-plan', options),
  organizerSelect: (ids) => ipcRenderer.invoke('studio:organizer-select', ids),
  organizerApply: () => ipcRenderer.invoke('studio:organizer-apply'),
  organizerUndo: () => ipcRenderer.invoke('studio:organizer-undo'),
  organizerLoad: (id) => ipcRenderer.invoke('studio:organizer-load', id),
  organizerSavePreset: (preset) => ipcRenderer.invoke('studio:organizer-save-preset', preset),
  organizerRemovePreset: (id) => ipcRenderer.invoke('studio:organizer-remove-preset', id),
  organizerRunPreset: (id) => ipcRenderer.invoke('studio:organizer-run-preset', id),
  organizerClearCache: () => ipcRenderer.invoke('studio:organizer-clear-cache'),
  snapshot: () => ipcRenderer.invoke('studio:snapshot'),
  save: (w) => ipcRenderer.invoke('studio:save', w),
  remove: (id) => ipcRenderer.invoke('studio:remove', id),
  chooseFolder: () => ipcRenderer.invoke('studio:folder'),
  chooseFile: () => ipcRenderer.invoke('studio:file'),
  execute: (id, source, preview) => ipcRenderer.invoke('studio:execute', id, source, preview),
  executeFolder: (id, folder, recursive, preview) =>
    ipcRenderer.invoke('studio:execute-folder', id, folder, recursive, preview),
  cancel: () => ipcRenderer.invoke('studio:cancel'),
  watch: (id, enabled) => ipcRenderer.invoke('studio:watch', id, enabled),
  undo: (id) => ipcRenderer.invoke('studio:undo', id),
  exportWorkflow: (id) => ipcRenderer.invoke('studio:export', id),
  importWorkflow: () => ipcRenderer.invoke('studio:import'),
  settings: (s) => ipcRenderer.invoke('studio:settings', s),
  testAI: () => ipcRenderer.invoke('studio:test-ai'),
  cloudSettings: () => ipcRenderer.invoke('studio:cloud-settings'),
  cloudAuth: (input) => ipcRenderer.invoke('studio:cloud-auth', input),
  cloudDisconnect: () => ipcRenderer.invoke('studio:cloud-disconnect'),
  cloudPush: (id) => ipcRenderer.invoke('studio:cloud-push', id),
  cloudPull: () => ipcRenderer.invoke('studio:cloud-pull'),
  cloudShare: (id) => ipcRenderer.invoke('studio:cloud-share', id),
  onUpdate: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('studio:update', listener);
    return () => ipcRenderer.removeListener('studio:update', listener);
  },
};
contextBridge.exposeInMainWorld('studio', api);
