import { contextBridge, ipcRenderer } from 'electron';
import type { StudioAPI } from '../shared/types';
const api: StudioAPI = {
  snapshot: () => ipcRenderer.invoke('studio:snapshot'),
  save: (w) => ipcRenderer.invoke('studio:save', w),
  remove: (id) => ipcRenderer.invoke('studio:remove', id),
  chooseFolder: () => ipcRenderer.invoke('studio:folder'),
  chooseFile: () => ipcRenderer.invoke('studio:file'),
  execute: (id, source, preview) => ipcRenderer.invoke('studio:execute', id, source, preview),
  cancel: () => ipcRenderer.invoke('studio:cancel'),
  watch: (id, enabled) => ipcRenderer.invoke('studio:watch', id, enabled),
  undo: (id) => ipcRenderer.invoke('studio:undo', id),
  exportWorkflow: (id) => ipcRenderer.invoke('studio:export', id),
  importWorkflow: () => ipcRenderer.invoke('studio:import'),
  settings: (s) => ipcRenderer.invoke('studio:settings', s),
  testAI: () => ipcRenderer.invoke('studio:test-ai'),
  onUpdate: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('studio:update', listener);
    return () => ipcRenderer.removeListener('studio:update', listener);
  },
};
contextBridge.exposeInMainWorld('studio', api);
