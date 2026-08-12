const { app, BrowserWindow, WebContentsView, session, shell, Menu } = require("electron");
const path = require("path");
const fs = require("fs");

const logger = require("./src/core/logger");
const store = require("./src/core/store");
const { registerIpc } = require("./src/ipc");

const PANEL_W = 400;
const PANEL_W_MIN = 44;
const CHAT_URL = "https://www.zhipin.com/web/geek/chat";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0";

app.commandLine.appendSwitch("disable-blink-features", "AutomationControlled");
app.commandLine.appendSwitch("no-proxy-server");

// 固定 userData 到系统固定目录（%APPDATA%/boss-ai-desktop）：
// portable exe 的 userData 默认跟随 exe 位置，exe 移动/重下会导致登录态与设置丢失，每次都要重新登录。
app.setPath("userData", path.join(app.getPath("appData"), "boss-ai-desktop"));

let win = null;
let bossView = null;
let panelView = null;
let matchView = null;
let panelCollapsed = false;
let ipc = null;

function layoutViews() {
  if (!win || !bossView || !panelView) return;
  const b = win.getContentBounds();
  const pw = panelCollapsed ? PANEL_W_MIN : PANEL_W;
  bossView.setBounds({ x: 0, y: 0, width: b.width - pw, height: b.height });
  panelView.setBounds({ x: b.width - pw, y: 0, width: pw, height: b.height });
  if (ipc) ipc.applyZoom();
}

function setCollapsed(v) {
  panelCollapsed = !!v;
}

// ---------- BOSS 页注入（content script + chrome.* 桥） ----------
function injectBossHelper(webContents) {
  const shim = `
window.__bossAiDesktop = true;
if (!window.__bossAiInjected) {
window.__bossAiInjected = true;
if (!window.chrome) window.chrome = {};
if (!window.chrome.storage) {
  const bridge = window.__bossBridge;
  const storageLocal = {
    get: (k) => bridge.storeGet(k),
    set: (o) => bridge.storeSet(o),
    remove: (k) => bridge.storeRemove(k)
  };
  window.chrome.storage = {
    local: storageLocal,
    onChanged: {
      addListener: (cb) => bridge.onStoreChanged((key, val) => cb({ [key]: { newValue: val } }, "local"))
    }
  };
  window.chrome.runtime = {
    id: "boss-ai-desktop",
    sendMessage: (msg) => bridge.sendToMain(msg),
    onMessage: {
      addListener: (cb) => {
        bridge.onPageMsg((id, payload) => {
          let sent = false;
          const sendResponse = (res) => { if (!sent) { sent = true; bridge.replyToMain(id, res); } };
          try {
            const ret = cb(payload, {}, sendResponse);
            if (ret === true) return;
            if (!sent) sendResponse(ret);
          } catch (err) { if (!sent) sendResponse({ error: String((err && err.message) || err) }); }
        });
      }
    }
  };
}
(() => {
  const s = document.createElement("style");
  s.id = "boss-ai-desktop-hide";
  s.textContent = "#boss-ai-helper-host { display: none !important; }";
  document.documentElement.appendChild(s);
})();
}
`;
  const contentSrc = fs.readFileSync(
    fs.existsSync(path.join(__dirname, "content", "content.js"))
      ? path.join(__dirname, "content", "content.js")
      : path.join(__dirname, "..", "content", "content.js"),
    "utf8"
  );
  webContents.executeJavaScript(shim + "\n;(function(){\n" + contentSrc + "\n})();", true).catch((e) => {
    logger.error("main", "inject content failed:", e.message);
  });
}

// ---------- 窗口 ----------
function createWindow() {
  win = new BrowserWindow({
    width: 1560,
    height: 1000,
    minWidth: 1180,
    minHeight: 720,
    title: "BOSS直聘 AI 助手",
    autoHideMenuBar: true,
    backgroundColor: "#f6f7f9"
  });

  bossView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, "preload-boss.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  panelView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, "preload-panel.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  win.contentView.addChildView(bossView);
  win.contentView.addChildView(panelView);

  // 隐藏后台窗口：岗位匹配用（搜索职位库，不打扰主视图）
  matchView = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  matchView.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  const layout = () => layoutViews();
  layout();
  win.on("resize", layout);

  const isZhipin = (url) => {
    try { return /(^|\.)zhipin\.com$/.test(new URL(url).hostname); }
    catch (e) { return false; }
  };
  const isXhs = (url) => {
    try { return /(^|\.)xiaohongshu\.com$/.test(new URL(url).hostname); }
    catch (e) { return false; }
  };

  bossView.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) {
      if (isZhipin(url) || isXhs(url)) bossView.webContents.loadURL(url);
      else shell.openExternal(url);
    }
    return { action: "deny" };
  });
  bossView.webContents.on("will-navigate", (e, url) => {
    if (/^https?:\/\//.test(url) && !isZhipin(url) && !isXhs(url)) { e.preventDefault(); shell.openExternal(url); }
  });
  bossView.webContents.on("did-finish-load", () => {
    const host = (() => { try { return new URL(bossView.webContents.getURL()).hostname; } catch (e) { return ""; } })();
    if (/(^|\.)zhipin\.com$/.test(host)) {
      setTimeout(() => { injectBossHelper(bossView.webContents); if (ipc) ipc.applyZoom(); }, 900);
    } else if (ipc) {
      ipc.applyZoom();
    }
  });

  ipc = registerIpc({ win, bossView, panelView, matchView, layoutViews, setCollapsed });

  bossView.webContents.on("ipc-message", (_e, channel, ...args) => {
    if (channel === "boss:reply") {
      const [id, res] = args;
      ipc.dispatchToBossReply(id, res);
    }
  });

  panelView.webContents.loadFile(path.join(__dirname, "panel.html"));
  bossView.webContents.loadURL(CHAT_URL);

  win.on("closed", () => { win = null; });
}

// ---------- 启动 ----------
app.whenReady().then(() => {
  logger.init({ dir: path.join(app.getPath("userData"), "logs"), level: "info" });
  logger.info("main", "app starting, version=", app.getVersion());
  store.load();
  session.defaultSession.setUserAgent(UA);
  Menu.setApplicationMenu(null);
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});