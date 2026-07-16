const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("playpenFS", {
  readAllContent: () => ipcRenderer.invoke("content:read-all"),
  writeContent: (relPath, text) => ipcRenderer.invoke("content:write", relPath, text),
  deleteContent: (relPath) => ipcRenderer.invoke("content:delete", relPath),
});
