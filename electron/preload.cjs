const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  hasKey: () => ipcRenderer.invoke('key:has'),
  setKey: (key) => ipcRenderer.invoke('key:set', key),
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
