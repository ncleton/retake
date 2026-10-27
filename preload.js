'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('revue', {
  info: () => ipcRenderer.invoke('app:info'),
  pendingOpen: () => ipcRenderer.invoke('app:pending-open'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  pickVideo: () => ipcRenderer.invoke('video:pick'),
  openVideo: (p) => ipcRenderer.invoke('video:open', p),
  pathForFile: (file) => webUtils.getPathForFile(file),
  loadReview: (sha) => ipcRenderer.invoke('review:load', sha),
  saveReview: (sha, review) => ipcRenderer.invoke('review:save', sha, review),
  writeAsset: (sha, rel, data) => ipcRenderer.invoke('review:write-asset', sha, rel, data),
  importReview: () => ipcRenderer.invoke('review:import'),
  importReviewPath: (p) => ipcRenderer.invoke('review:import-path', p),
  exportReport: (payload) => ipcRenderer.invoke('report:export', payload),
  chooseExportDir: () => ipcRenderer.invoke('report:choose-dir'),
  reveal: (p) => ipcRenderer.invoke('shell:reveal', p),
  copy: (t) => ipcRenderer.invoke('clipboard:write', t),
  on: (channel, cb) => {
    if (!['video:hash-progress', 'menu', 'open-path'].includes(channel)) throw new Error('Canal refusé : ' + channel);
    ipcRenderer.on(channel, (_e, ...args) => cb(...args));
  },
});
