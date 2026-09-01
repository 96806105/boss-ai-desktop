const { ipcMain, dialog, app } = require("electron");
const fs = require("fs");
const path = require("path");
const logger = require("./core/logger");
const store = require("./core/store");
const llm = require("./core/llm");
const orchestrator = require("./orchestrator");
const { list: listAgents } = require("./registry");
const imageBank = require("./core/image-bank");

/**
 * IPC 路由器：所有主进程能力对渲染层的唯一通道。
 * 依赖注入 win/bossView/panelView（由 main 装配，避免循环依赖）。
 */
function registerIpc({ win, bossView, panelView, matchView, layoutViews, setCollapsed }) {
  const bossActions = new Map();
  let actionSeq = 0;

  function dispatchToBoss(payload, timeoutMs = 90000) {
    return new Promise((resolve) => {
      const id = ++actionSeq;
      const timer = setTimeout(() => { bossActions.delete(id); resolve({ ok: false, error: "操作超时" }); }, timeoutMs);
      bossActions.set(id, (res) => { clearTimeout(timer); bossActions.delete(id); resolve(res); });
      bossView.webContents.send("boss:msg", id, payload);
    });
  }

  // ---------- 存储 ----------
  ipcMain.handle("store:get", (_e, key) => ({ [key]: store.get(key) }));
  ipcMain.handle("store:set", async (_e, obj) => {
    const changed = store.set(obj);
    for (const k of changed) {
      for (const wc of [bossView.webContents, panelView.webContents]) {
        try { wc.send("store:changed", k, store.get(k)); } catch (e) {}
      }
    }
    return { ok: true };
  });
  ipcMain.handle("store:remove", (_e, key) => {
    const existed = store.remove(key);
    for (const wc of [bossView.webContents, panelView.webContents]) {
      try { wc.send("store:changed", key, undefined); } catch (e) {}
    }
    return { ok: existed };
  });

  // ---------- 简历图片库 ----------
  ipcMain.handle("img:list", () => ({ ok: true, images: imageBank.list() }));
  ipcMain.handle("img:pick", () => imageBank.pick(win));
  ipcMain.handle("img:del", (_e, id) => ({ ok: imageBank.remove(String(id || "")) }));
  ipcMain.handle("img:read", (_e, id) => {
    const d = imageBank.readDataUrl(String(id || ""));
    return d ? { ok: true, ...d } : { ok: false, error: "图片不存在" };
  });

  // ---------- BOSS 页消息桥 ----------
  ipcMain.handle("boss:page-msg", async (_e, msg) => {
    try {
      if (msg && msg.type === "generate") {
        const { text } = await llm.call(msg.payload || {});
        return { ok: true, text };
      }
      if (msg && msg.type === "generate-agent") {
        // 招呼语/回复：统一走多智能体编排（GreetingAgent v4 / ReplyAgent v2）
        const settings = store.getSettings();
        if (msg.kind === "greeting") {
          const res = await orchestrator.invoke("greeting", { jd: msg.jd || {}, settings }, { onProgress: () => {} });
          return { ok: true, text: res.text, jd: msg.jd || {} };
        }
        if (msg.kind === "reply") {
          const res = await orchestrator.invoke("reply", { jd: msg.jd || {}, history: msg.history || [], settings }, { onProgress: () => {} });
          return { ok: true, text: res.text, jd: msg.jd || {} };
        }
        return { ok: false, error: "未知生成类型" };
      }
      if (msg && msg.type === "openOptions") {
        panelView.webContents.send("panel:nav", "settings");
        return { ok: true };
      }
      if (msg && msg.type === "openPanel") {
        setCollapsed(false);
        layoutViews();
        panelView.webContents.send("panel:nav", "assist");
        if (win) { win.show(); win.focus(); }
        return { ok: true };
      }
      if (msg && msg.type === "cancel") {
        let cancelled = false;
        try { cancelled = orchestrator.cancel(); } catch (e) {}
        if (matchAbort) { try { matchAbort.abort(); } catch (e) {} cancelled = true; }
        return { ok: true, cancelled };
      }
      // 聊天列表页自动打开第一条会话：合成 click 会被 BOSS 新版页面忽略，须用 sendInputEvent 发真实输入事件
      if (msg && msg.type === "desktop-open-first-chat" && typeof msg.x === "number" && typeof msg.y === "number") {
        if (!bossView || bossView.webContents.isDestroyed()) return { ok: false, error: "页面未就绪" };
        const wc = bossView.webContents;
        const zoom = wc.getZoomFactor() || 1;
        wc.sendInputEvent({ type: "mouseDown", x: Math.round(msg.x * zoom), y: Math.round(msg.y * zoom), button: "left", clickCount: 1 });
        wc.sendInputEvent({ type: "mouseUp", x: Math.round(msg.x * zoom), y: Math.round(msg.y * zoom), button: "left", clickCount: 1 });
        return { ok: true };
      }
      // 简历图片库（操作台悬浮组件调用）
      if (msg && msg.type === "pick-image") {
        const r = await imageBank.pick(win);
        return { ok: true, ...r };
      }
      if (msg && msg.type === "list-images") {
        return { ok: true, images: imageBank.list() };
      }
      if (msg && msg.type === "read-image") {
        const d = imageBank.readDataUrl(String((msg && msg.id) || ""));
        return d ? { ok: true, ...d } : { ok: false, error: "图片不存在" };
      }
      if (msg && msg.type === "delete-image") {
        return { ok: imageBank.remove(String((msg && msg.id) || "")), images: imageBank.list() };
      }
      return { ok: false, error: "未知消息类型" };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    }
  });

  ipcMain.handle("boss:action", (_e, payload) => {
    if (!bossView || bossView.webContents.isDestroyed()) return { ok: false, error: "BOSS 页面未就绪" };
    const timeout = (payload && payload._timeout) || 90000;
    const { _timeout, ...rest } = payload || {};
    return dispatchToBoss(rest, timeout);
  });

  // ---------- 智能体编排 ----------
  ipcMain.handle("agent:list", () => ({ ok: true, agents: listAgents() }));
  ipcMain.handle("agent:invoke", async (_e, req) => {
    const intent = req && req.intent;
    if (!intent) return { ok: false, error: "缺少智能体意图" };
    try {
      const input = { ...((req && req.input) ?? (req && req.task) ?? {}), settings: store.getSettings() };
      const res = await orchestrator.invoke(intent, input, {
        onProgress: (label, total) => {
          try { panelView.webContents.send("agent:event", { type: "progress", intent, label, total }); } catch (e) {}
        }
      });
      return { ok: true, ...res };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    }
  });
  ipcMain.handle("agent:log", () => ({ ok: true, log: orchestrator.getLog() }));
  ipcMain.handle("agent:log-clear", () => ({ ok: true, cleared: orchestrator.clearLog() }));
  ipcMain.handle("agent:stats", () => ({ ok: true, stats: llm.getStats() }));

  // ---------- 停止当前任务（智能体 / 岗位匹配后台检索） ----------
  ipcMain.handle("agent:cancel", () => {
    let cancelled = false;
    try { cancelled = orchestrator.cancel(); } catch (e) {}
    if (matchAbort) {
      try { matchAbort.abort(); } catch (e) {}
      cancelled = true;
    }
    return { ok: true, cancelled };
  });
  ipcMain.handle("agent:current", () => ({
    ok: true,
    current: orchestrator.getCurrent(),
    busy: orchestrator.isBusy()
  }));

  // ---------- API 测试连接 ----------
  ipcMain.handle("api:test", async () => {
    const s = store.getSettings();
    if (!s.apiKey) return { ok: false, error: "未配置 API Key，请先填写" };
    try {
      const r = await llm.call({
        apiKey: s.apiKey,
        model: s.model,
        messages: [{ role: "user", content: "请只回复四个字：连接正常" }],
        temperature: 0,
        maxRetries: 0
      });
      return { ok: true, model: s.model || llm.DEFAULT_MODEL, text: String(r.text || "").slice(0, 60) };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    }
  });

  // ---------- 尽调报告导出 Markdown ----------
  ipcMain.handle("file:save-report", async (_e, name, content) => {
    try {
      const def = String(name || "尽调报告").replace(/[\\/:*?"<>|]/g, "-").slice(0, 60) + ".md";
      const r = await dialog.showSaveDialog(win, {
        title: "导出报告",
        defaultPath: def,
        filters: [{ name: "Markdown", extensions: ["md"] }, { name: "文本文件", extensions: ["txt"] }]
      });
      if (r.canceled || !r.filePath) return { ok: false, cancelled: true };
      fs.writeFileSync(r.filePath, String(content || ""), "utf8");
      return { ok: true, path: r.filePath };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    }
  });

  // ---------- 日志读取（诊断用） ----------
  ipcMain.handle("log:read", (_e, lines) => {
    try {
      const f = path.join(app.getPath("userData"), "logs", "app.log");
      if (!fs.existsSync(f)) return { ok: true, lines: [], file: f };
      const text = fs.readFileSync(f, "utf8");
      const arr = text.split(/\r?\n/).filter(Boolean);
      return { ok: true, lines: arr.slice(-(Math.max(20, Number(lines) || 100))), file: f };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    }
  });

  // ---------- 岗位匹配（手动 + 定时 + 新匹配提醒） ----------
  const MATCH_SETTINGS_KEY = "bossAiMatchSettings";
  let matchTimer = null;
  let matchLastIds = null;
  let matchRunning = false;
  let matchAbort = null;

  function getMatchSettings() {
    return { enabled: false, intervalMin: 30, threshold: 70, ...(store.get(MATCH_SETTINGS_KEY) || {}) };
  }

  function notifyMatchNew(newOnes, threshold) {
    if (!newOnes || !newOnes.length) return;
    try {
      panelView.webContents.send("match:new", {
        count: newOnes.length,
        threshold,
        items: newOnes.map((j) => ({ id: j.id, title: j.title, company: j.company, score: j.score }))
      });
    } catch (e) {}
    logger.info("ipc", "match new found:", newOnes.length);
  }

  /** 在隐藏窗口中搜索职位库：逐关键词 × 翻页抓取 */
  const MATCH_COLLECT_JS = `
  (function () {
    const isVis = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const pick = (root, sels) => { for (const s of sels) { const n = root.querySelector(s); if (n) return n; } return null; };
    const txt = (el) => (el ? (el.textContent || "").trim() : "");
    const rows = [];
    for (const li of document.querySelectorAll("li.job-card-box")) {
      if (!isVis(li)) continue;
      const a = li.querySelector("a.job-name");
      const href = a ? (a.getAttribute("href") || "") : "";
      const id = (/\\/job_detail\\/([^.]+)\\.html/.exec(href) || [])[1] || href;
      const title = txt(pick(li, [".job-name", "a.job-name"]));
      if (!title) continue;
      const salaryTxt = txt(li.querySelector(".job-salary")).replace(/[\\uE000-\\uF8FF]/g, (c) => {
        const cp = c.codePointAt(0);
        return cp >= 0xE031 && cp <= 0xE03A ? String(cp - 0xE031) : c;
      });
      const mR = String(salaryTxt).match(/(\\d+)\\s*[-~—至]\\s*(\\d+)\\s*[Kk]/);
      rows.push({
        id: id,
        title: title,
        salary: salaryTxt,
        salaryMin: mR ? Number(mR[1]) : 0,
        salaryMax: mR ? Number(mR[2]) : 0,
        company: txt(pick(li, [".boss-info .boss-name", ".boss-name"])),
        location: txt(li.querySelector(".company-location")),
        tags: Array.from(li.querySelectorAll(".tag-list li")).map((x) => txt(x)).join("、"),
        href: href
      });
    }
    return rows;
  })()`;

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  /** BOSS 城市代码表（常用城市） */
  const CITY_CODES = {
    "北京": "101010100", "上海": "101020100", "天津": "101030100", "重庆": "101040100",
    "苏州": "101190400", "南京": "101190100", "无锡": "101190200", "常州": "101191100", "南通": "101190500", "徐州": "101190800", "扬州": "101190600", "镇江": "101190300", "盐城": "101190700", "泰州": "101191200", "淮安": "101190900", "连云港": "101191000", "宿迁": "101191300",
    "杭州": "101210100", "宁波": "101210400", "温州": "101210700", "嘉兴": "101210300", "绍兴": "101210500", "金华": "101210900", "台州": "101210600", "湖州": "101210200", "衢州": "101211000", "丽水": "101210800",
    "广州": "101280100", "深圳": "101280600", "珠海": "101280700", "佛山": "101280800", "东莞": "101281600", "中山": "101281700", "惠州": "101280300", "江门": "101281100", "汕头": "101280500", "湛江": "101281000", "肇庆": "101280900",
    "成都": "101270100", "绵阳": "101270400", "德阳": "101272000", "乐山": "101271400",
    "武汉": "101200100", "宜昌": "101200900", "襄阳": "101201100", "荆州": "101200800",
    "西安": "101110100", "咸阳": "101110200", "宝鸡": "101110900",
    "郑州": "101180100", "洛阳": "101180900", "开封": "101180800", "新乡": "101180300",
    "长沙": "101250100", "株洲": "101250300", "湘潭": "101250200",
    "青岛": "101120200", "济南": "101120100", "烟台": "101120500", "潍坊": "101120600", "威海": "101121300",
    "厦门": "101230200", "福州": "101230100", "泉州": "101230500", "漳州": "101230600",
    "合肥": "101220100", "芜湖": "101220300",
    "沈阳": "101070100", "大连": "101070200",
    "昆明": "101290100", "贵阳": "101260100", "南昌": "101240100", "南宁": "101300100", "石家庄": "101090100", "太原": "101100100", "哈尔滨": "101050100", "长春": "101060100", "兰州": "101160100", "海口": "101310100", "乌鲁木齐": "101130100", "呼和浩特": "101080100", "银川": "101170100", "西宁": "101150100", "拉萨": "101140100"
  };

  /** 从补充要求中解析意向城市（如"意向城市：苏州"），返回 BOSS 城市代码或空 */
  function extractCityCodeFromExtra(extra) {
    const t = String(extra || "");
    const m = t.match(/(?:意向|期望|想去|考虑)?\s*(?:城市|地点|工作地|base|所在地|位置)\s*[:：为是]\s*([\u4e00-\u9fa5]{2,4})/) ||
      t.match(/(?:只|就|想)去\s*([\u4e00-\u9fa5]{2,4})(?:工作|发展|那边)?/);
    if (!m) return "";
    const name = m[1].replace(/市$/, "");
    for (const [k, v] of Object.entries(CITY_CODES)) {
      if (name === k || name.includes(k) || k.includes(name)) return v;
    }
    return "";
  }

  async function searchJobLibrary(matchViewRef, keywords, city, pagesPerWord, onStage, signal) {
    const all = [];
    const seen = new Set();
    const wc = matchViewRef && matchViewRef.webContents;
    if (!wc || wc.isDestroyed()) throw new Error("后台检索窗口未就绪");
    const pages = Math.max(1, Math.min(3, Number(pagesPerWord) || 1));
    for (let i = 0; i < keywords.length; i++) {
      if (signal && signal.aborted) throw new Error("任务已取消");
      const kw = keywords[i];
      for (let pg = 1; pg <= pages; pg++) {
        if (signal && signal.aborted) throw new Error("任务已取消");
        if (onStage) onStage("检索中：" + kw + (pages > 1 ? " · 第" + pg + "页" : "") + "（" + (i + 1) + "/" + keywords.length + " 个关键词）");
        const url = "https://www.zhipin.com/web/geek/jobs?query=" + encodeURIComponent(kw) + "&city=" + encodeURIComponent(city || "101010100") + (pg > 1 ? "&page=" + pg : "");
        await wc.loadURL(url).catch(() => {});
        await sleep(4500);
        if (signal && signal.aborted) throw new Error("任务已取消");
        try {
          const rows = await wc.executeJavaScript(MATCH_COLLECT_JS, true);
          if (Array.isArray(rows)) {
            for (const r of rows) {
              const key = r.id || (r.title + r.company);
              if (seen.has(key)) continue;
              seen.add(key);
              all.push(r);
            }
          }
        } catch (e) {
          logger.warn("ipc.match", "collect failed on page", kw, pg, e.message);
        }
        await sleep(800 + Math.random() * 600);
      }
    }
    return all;
  }

  /** 后台检索窗口登录/风控检测：无法区分"无岗位"与"未登录/验证码"时给出准确提示 */
  async function detectMatchBlocked(wc) {
    try {
      if (!wc || wc.isDestroyed()) return "后台窗口未就绪";
      const t = await wc.executeJavaScript(
        "(function(){ try { var b = document.body; return b ? b.innerText.slice(0, 4000) : ''; } catch (e) { return ''; } })()",
        true
      );
      const s = String(t || "");
      if (/验证码|安全验证|滑动验证/.test(s)) return "安全验证";
      if (/扫码登录|扫码|登录后|未登录/.test(s) && !/立即登录/.test(s)) return "未登录";
      return "";
    } catch (e) {
      return "";
    }
  }

  async function runMatchOnce({ silent } = {}) {
    if (matchRunning || orchestrator.isBusy()) {
      const reason = matchRunning ? "上一次匹配尚未结束" : "有其他任务（" + ((orchestrator.getCurrent() || {}).agentName || "智能体") + "）执行中";
      store.set({ bossAiMatchLastSkip: { ts: Date.now(), reason } });
      return { ok: false, error: reason, busy: true };
    }
    if (!bossView || bossView.webContents.isDestroyed()) return { ok: false, error: "BOSS 页面未就绪" };
    const settings = store.getSettings();
    const resumeText = store.resolveResume(settings);
    if (!resumeText || !String(resumeText).trim()) return { ok: false, error: "请先在设置页填写简历" };
    matchRunning = true;
    const matchController = new AbortController();
    matchAbort = matchController;
    try {
      const { extractResumeKeywords } = require("./core/tools");
      const keywords = extractResumeKeywords(resumeText);
      if (!keywords.length) return { ok: false, error: "无法从简历提取技能关键词，请完善简历中的技能/经历描述" };
      const city = (() => {
        const cfg = getMatchSettings();
        const fromExtra = extractCityCodeFromExtra(cfg.extra);
        if (fromExtra) return fromExtra;
        try { return new URL(bossView.webContents.getURL()).searchParams.get("city") || "101010100"; } catch (e) { return "101010100"; }
      })();
      const onStage = (label) => {
        try { panelView.webContents.send("agent:event", { type: "progress", intent: "match", label }); } catch (e) {}
      };
      onStage("正在从职位库检索：" + keywords.length + " 个关键词");
      const jobs = await searchJobLibrary(matchView, keywords, city, 1, onStage, matchController.signal);
      if (!jobs.length) {
        const blocked = await detectMatchBlocked(matchView.webContents);
        if (blocked) return { ok: false, error: "职位库检索被拦截：" + blocked + "。请在左侧主窗口正常登录 BOSS 并手动打开一次职位列表后重试" };
        return { ok: false, error: "职位库检索无结果（可能触发验证码，请稍后重试或在 BOSS 页面手动操作一次）" };
      }
      onStage("已收集 " + jobs.length + " 个候选岗位，开始深度匹配");
      const res = await orchestrator.invoke("match", { resumeText, jobs: jobs.slice(0, 60), extra: getMatchSettings().extra }, { onProgress: onStage, signal: matchController.signal });
      const matched = res.matched || [];
      const cfg = getMatchSettings();
      const prevIds = matchLastIds || new Set();
      // 首跑基线：仅当存在历史运行记录时才提示"新发现"，避免首次全量弹横幅
      const hasBaseline = !!matchLastIds || !!store.get("bossAiMatchLastTs");
      const newOnes = hasBaseline ? matched.filter((j) => j.score >= cfg.threshold && !prevIds.has(j.id)) : [];
      matchLastIds = new Set(matched.map((j) => j.id).filter(Boolean));
      if (!silent) notifyMatchNew(newOnes, cfg.threshold);
      store.set({ bossAiMatchLastTs: Date.now(), bossAiMatchLastNew: newOnes.slice(0, 10), bossAiMatchLastSkip: null });
      return {
        ok: true,
        total: jobs.length,
        ts: Date.now(),
        keywords,
        city,
        matched,
        newOnes,
        text: res.text
      };
    } catch (err) {
      if (matchController.signal.aborted) return { ok: false, cancelled: true, error: "已停止" };
      return { ok: false, error: String((err && err.message) || err) };
    } finally {
      matchRunning = false;
      matchAbort = null;
    }
  }

  ipcMain.handle("match:run", async () => {
    const r = await runMatchOnce({ silent: false });
    return r;
  });

  ipcMain.handle("match:schedule", (_e, cfg) => {
    const next = { ...getMatchSettings(), ...(cfg || {}) };
    store.set({ [MATCH_SETTINGS_KEY]: next });
    if (matchTimer) { clearInterval(matchTimer); matchTimer = null; }
    if (next.enabled) {
      const interval = Math.max(5, Number(next.intervalMin) || 30) * 60000;
      matchTimer = setInterval(() => { runMatchOnce({ silent: false }).catch(() => {}); }, interval);
      logger.info("ipc", "match timer started, interval=", interval / 60000, "min");
    }
    return { ok: true, settings: next };
  });

  ipcMain.handle("match:status", () => ({
    ok: true,
    settings: getMatchSettings(),
    lastRunTs: store.get("bossAiMatchLastTs") || null,
    lastNew: store.get("bossAiMatchLastNew") || [],
    lastSkip: store.get("bossAiMatchLastSkip") || null
  }));

  // 定时器在注册阶段恢复（应用重启后继续生效）
  {
    const cfg = getMatchSettings();
    if (cfg.enabled) {
      const interval = Math.max(5, Number(cfg.intervalMin) || 30) * 60000;
      matchTimer = setInterval(() => { runMatchOnce({ silent: false }).catch(() => {}); }, interval);
      logger.info("ipc", "match timer restored, interval=", interval / 60000, "min");
    }
  }

  // Agent 事件流 → 面板
  const events = ["agent:start", "agent:done", "agent:error", "agent:cancelled"];
  for (const ev of events) {
    orchestrator.on(ev, (data) => {
      try { panelView.webContents.send("agent:event", { type: ev, ...data }); } catch (e) {}
    });
  }
  logger.info("ipc", "agent events forwarded");

  // ---------- 面板/窗口 ----------
  ipcMain.handle("panel:collapse", () => { setCollapsed(true); layoutViews(); return { ok: true }; });
  ipcMain.handle("panel:expand", () => { setCollapsed(false); layoutViews(); return { ok: true }; });

  ipcMain.handle("win:pin", () => {
    const pinned = !win.isAlwaysOnTop();
    win.setAlwaysOnTop(pinned);
    return { ok: true, pinned };
  });
  ipcMain.handle("win:set-size", (_e, w, h) => {
    win.setSize(w, h);
    return { ok: true };
  });

  // ---------- BOSS 视图控制 ----------
  ipcMain.handle("boss:zoom", (_e, level) => {
    const settings = store.getSettings();
    if (level === "auto") {
      delete settings.bossZoom;
    } else {
      settings.bossZoom = Math.min(2, Math.max(0.5, Number(level) || 1));
    }
    store.set({ bossAiSettings: settings });
    const z = applyZoom();
    for (const wc of [bossView.webContents, panelView.webContents]) {
      try { wc.send("store:changed", "bossAiSettings", settings); } catch (e) {}
    }
    return { ok: true, zoom: z, manual: typeof settings.bossZoom === "number" };
  });
  ipcMain.handle("boss:zoom-get", () => {
    const s = store.getSettings();
    return { ok: true, zoom: applyZoom(), manual: typeof s.bossZoom === "number" };
  });
  ipcMain.handle("boss:reload", () => {
    bossView.webContents.reload();
    return { ok: true };
  });
  ipcMain.handle("boss:nav", (_e, dir) => {
    if (dir === "back") bossView.webContents.goBack();
    else if (dir === "forward") bossView.webContents.goForward();
    return { ok: true };
  });
  ipcMain.handle("boss:goto", (_e, url) => {
    bossView.webContents.loadURL(url || "https://www.zhipin.com/web/geek/chat");
    return { ok: true };
  });
  // 打开岗位详情（匹配结果跳转）：href 为相对路径，拼全域名导航到主视图
  ipcMain.handle("boss:open-job", (_e, href) => {
    try {
      const h = String(href || "").trim();
      if (!h) return { ok: false, error: "缺少岗位链接" };
      const full = /^https?:/.test(h) ? h : "https://www.zhipin.com" + h;
      if (!/zhipin\.com/.test(full)) return { ok: false, error: "非法链接" };
      bossView.webContents.loadURL(full);
      return { ok: true, url: full };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    }
  });
  ipcMain.handle("boss:zoom-apply", () => ({ ok: true, zoom: applyZoom() }));

  // ---------- 小红书舆情采集（主视图内打开，记住原页面一键返回） ----------
  const XHS_SEARCH = "https://www.xiaohongshu.com/search_result?keyword=";
  let xhsReturnUrl = null;
  ipcMain.handle("xhs:open", async (_e, company) => {
    const kw = encodeURIComponent(String(company || "").trim());
    if (!kw) return { ok: false, error: "请输入公司名称" };
    try {
      const cur = bossView.webContents.getURL();
      if (cur && !/xiaohongshu\.com/.test(cur)) xhsReturnUrl = cur;
      bossView.webContents.loadURL(XHS_SEARCH + kw + "&source=web_search_result_notes");
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    }
  });
  ipcMain.handle("xhs:back", async () => {
    try {
      const target = xhsReturnUrl || "https://www.zhipin.com/web/geek/chat";
      bossView.webContents.loadURL(target);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    }
  });

  function applyZoom() {
    if (!bossView.webContents || bossView.webContents.isDestroyed()) return null;
    const s = store.getSettings();
    let zoom = null;
    if (typeof s.bossZoom === "number" && s.bossZoom >= 0.5 && s.bossZoom <= 2) zoom = s.bossZoom;
    if (zoom === null) {
      const b = win.getContentBounds();
      const pw = (panelView.getBounds() || {}).width || 400;
      const bw = b.width - pw;
      zoom = bw >= 1200 ? 1 : Math.max(0.72, Math.round((bw / 1200) * 100) / 100);
    }
    if (Math.abs((bossView.webContents.getZoomFactor() || 1) - zoom) > 0.01) {
      bossView.webContents.setZoomFactor(zoom);
    }
    return zoom;
  }

  return {
    dispatchToBoss,
    dispatchToBossReply: (id, res) => {
      const cb = bossActions.get(id);
      if (cb) cb(res);
    },
    applyZoom
  };
}

module.exports = { registerIpc };