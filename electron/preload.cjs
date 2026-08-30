const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("veil", {
  platform: process.platform,
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
