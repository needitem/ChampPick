'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('champpick', {
  onState: (cb) => ipcRenderer.on('state', (_e, s) => cb(s)),
  swap: (championId) => ipcRenderer.invoke('swap', championId),
  reroll: () => ipcRenderer.invoke('reroll'),
  close: () => ipcRenderer.send('close-app'),
});
