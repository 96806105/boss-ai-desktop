const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("panelApi", {
  // 存储
  getStore: (key) => ipcRenderer.invoke("store:get", key),
  setStore: (obj) => ipcRenderer.invoke("store:set", obj),
  // BOSS 页
  bossAction: (payload) => ipcRenderer.invoke("boss:action", payload),
  reloadBoss: () => ipcRenderer.invoke("boss:reload"),
  navBoss: (dir) => ipcRenderer.invoke("boss:nav", dir),
  setBossZoom: (level) => ipcRenderer.invoke("boss:zoom", level),
  getBossZoom: () => ipcRenderer.invoke("boss:zoom-get"),
  gotoChat: () => ipcRenderer.invoke("boss:goto"),
  openJob: (href) => ipcRenderer.invoke("boss:open-job", href),
  // 小红书舆情采集（主视图内打开）
  xhsOpen: (company) => ipcRenderer.invoke("xhs:open", company),
  xhsBack: () => ipcRenderer.invoke("xhs:back"),
  // 智能体编排
  agentInvoke: (intent, input) => ipcRenderer.invoke("agent:invoke", { intent, input }),
  agentList: () => ipcRenderer.invoke("agent:list"),
  agentLog: () => ipcRenderer.invoke("agent:log"),
  agentLogClear: () => ipcRenderer.invoke("agent:log-clear"),
  agentStats: () => ipcRenderer.invoke("agent:stats"),
  // 岗位匹配
  matchRun: () => ipcRenderer.invoke("match:run"),
  matchSchedule: (cfg) => ipcRenderer.invoke("match:schedule", cfg),
  matchStatus: () => ipcRenderer.invoke("match:status"),
  onMatchNew: (cb) => ipcRenderer.on("match:new", (_e, data) => cb(data)),
  // 兼容旧接口（迁移期保留）
  llmPrepInterview: (payload) => ipcRenderer.invoke("llm:prep-interview", payload),
  analyzeCompany: (company) => ipcRenderer.invoke("company:analyze", company),
  // 窗口
  setPin: () => ipcRenderer.invoke("win:pin"),
  collapse: () => ipcRenderer.invoke("panel:collapse"),
  expand: () => ipcRenderer.invoke("panel:expand"),
  // 事件
  onStoreChanged: (cb) => ipcRenderer.on("store:changed", (_e, key, val) => cb(key, val)),
  onNav: (cb) => ipcRenderer.on("panel:nav", (_e, section) => cb(section)),
  onAgentEvent: (cb) => ipcRenderer.on("agent:event", (_e, data) => cb(data))
});