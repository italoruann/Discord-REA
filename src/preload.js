'use strict';
// Ponte segura entre o renderer e o processo principal (equivalente ao "DiscordNative" do app original).
const { contextBridge, ipcRenderer } = require('electron');

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

contextBridge.exposeInMainWorld('native', {
  platform: process.platform,
  config: { server: arg('rea-server'), dev: process.argv.includes('--rea-dev') },
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
    flash: () => ipcRenderer.send('window:flash'),
    onState: (cb) => ipcRenderer.on('window:state', (e, s) => cb(s)),
  },
  setBadge: (count) => ipcRenderer.send('app:badge', count),
  notify: (title, body) => ipcRenderer.send('notify', { title, body }),
  ptt: {
    configure: (enabled, bind) => ipcRenderer.invoke('ptt:configure', { enabled, bind }),
    record: () => ipcRenderer.invoke('ptt:record'),
    keyNames: () => ipcRenderer.invoke('ptt:keynames'),
    onState: (cb) => ipcRenderer.on('ptt:state', (e, down) => cb(down)),
    onRecorded: (cb) => ipcRenderer.on('ptt:recorded', (e, bind) => cb(bind)),
  },
  capture: {
    getSources: () => ipcRenderer.invoke('capture:sources'),
    select: (id, audio) => ipcRenderer.invoke('capture:select', { id, audio }),
  },
});
