import { contextBridge, ipcRenderer } from 'electron';
import type { StudioAPI } from '../shared/types';
const api: StudioAPI = {
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
