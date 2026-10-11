const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  keysStatus: () => ipcRenderer.invoke('keys:status'),
  testKey: (provider, key) => ipcRenderer.invoke('key:test', provider, key),
  setKey: (provider, key) => ipcRenderer.invoke('key:set', provider, key),
  clipboardKey: (provider) => ipcRenderer.invoke('clipboard:keyFor', provider),
  listModels: (provider) => ipcRenderer.invoke('models:list', provider),
  sendChat: (req) => ipcRenderer.invoke('chat:send', req),
  stopChat: (requestId) => ipcRenderer.invoke('chat:stop', requestId),
  onChunk: (cb) => {
    const handler = (_e, payload) => cb(payload)
    ipcRenderer.on('chat:chunk', handler)
    return () => ipcRenderer.removeListener('chat:chunk', handler)
  },
  onQuickAsk: (cb) => {
    const handler = (_e, payload) => cb(payload)
    ipcRenderer.on('quick:ask', handler)
    return () => ipcRenderer.removeListener('quick:ask', handler)
  },
})
