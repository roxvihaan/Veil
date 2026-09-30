const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("veil", {
  platform: process.platform,
  dropImage: (id,file) => {
    let filePath='';try{filePath=webUtils.getPathForFile(file);}catch{}
    return ipcRenderer.invoke('terminal:image-drop',{id,file:filePath});
  },
  pipAction: (action) => ipcRenderer.send('pip:action', action),
  pipPanes: (panes) => ipcRenderer.send('pip:panes', panes),
  onPiP: (callback) => {
    const handler = (_event, message) => callback(message);
    ipcRenderer.on('pip:event', handler);
    return () => ipcRenderer.removeListener('pip:event', handler);
  },
  getConfig: () => ipcRenderer.invoke("config:get"),
  setConfig: (key, value) => ipcRenderer.invoke("config:set", { key, value }),
  openConfig: () => ipcRenderer.invoke("config:open"),
  onConfigChanged: (callback) => {
    const handler = (_event, config) => callback(config);
    ipcRenderer.on("config:changed", handler);
    return () => ipcRenderer.removeListener("config:changed", handler);
  },
  createTerminal: (options) => ipcRenderer.invoke("terminal:create", options),
  writeTerminal: (id, data) => ipcRenderer.send("terminal:write", { id, data }),
  resizeTerminal: (id, cols, rows) => ipcRenderer.send("terminal:resize", { id, cols, rows }),
  closeTerminal: (id) => ipcRenderer.send("terminal:close", id),
  onTerminalData: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("terminal:data", handler);
    return () => ipcRenderer.removeListener("terminal:data", handler);
  },
  onTerminalExit: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("terminal:exit", handler);
    return () => ipcRenderer.removeListener("terminal:exit", handler);
  },
});
