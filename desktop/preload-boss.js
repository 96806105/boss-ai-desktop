const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("__bossBridge", {
  storeGet: (key) => ipcRenderer.invoke("store:get", key),
  storeSet: (obj) => ipcRenderer.invoke("store:set", obj),
  storeRemove: (key) => ipcRenderer.invoke("store:remove", key),
  onStoreChanged: (cb) => ipcRenderer.on("store:changed", (_e, key, val) => cb(key, val)),
  sendToMain: (msg) => ipcRenderer.invoke("boss:page-msg", msg),
  onPageMsg: (cb) => ipcRenderer.on("boss:msg", (_e, id, payload) => cb(id, payload)),
  replyToMain: (id, res) => ipcRenderer.send("boss:reply", id, res)
});