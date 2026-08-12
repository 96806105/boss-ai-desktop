(() => {
  "use strict";

  const STORE_KEY = "bossAiSettings";
  const HISTORY_CAP = 50;

  let settings = null;
  let filterState = null;

  // ---------- 基础工具 ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $all = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function pickText(selectors, root = document) {
    for (const sel of selectors) {
      const el = root.querySelector(sel);
      if (el && el.textContent && el.textContent.trim()) {
        return el.textContent.trim().replace(/\s+/g, " ").replace(/\u200b/g, "");
      }
    }
    return "";
  }

  function pickTextList(selectors, root = document) {
    for (const sel of selectors) {
      const els = root.querySelectorAll(sel);
      const arr = Array.from(els)
        .map((el) => el.textContent.trim().replace(/\s+/g, " "))
        .filter(Boolean);
      if (arr.length) return arr;
    }
    return [];
  }

  function getSettings() {
    return settings || (settings = { apiKey: "", model: "deepseek-chat", style: "prof", customPrompt: "", resumeText: "", resumeFileName: "", autoReply: true, cooldown: 10, maxContext: 8, msgSelector: "", notifySound: false });
  }

  async function loadSettings() {
    const data = await chrome.storage.local.get(STORE_KEY);
    const s = data[STORE_KEY] || {};
    settings = {
      apiKey: s.apiKey || "",
      model: s.model || "deepseek-chat",
      style: s.style || "prof",
      customPrompt: s.customPrompt || "",
      resumeText: s.resumeText || "",
      resumeFileName: s.resumeFileName || "",
      autoReply: s.autoReply !== false,
      cooldown: s.cooldown || 10,
      maxContext: s.maxContext || 8,
      msgSelector: s.msgSelector || "",
      notifySound: !!s.notifySound
    };
  }

  // 设置页保存后实时生效（无需刷新 BOSS 页面）
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes[STORE_KEY]) return;
    loadSettings().then(() => {
      try {
        showHint();
        renderPending();
      } catch (e) {}
    });
  });

  function truncate(text, n) {
    text = text || "";
    return text.length > n ? text.slice(0, n) + "…" : text;
  }

  // BOSS 直聘薪资字体加密：U+E031~U+E03A 对应 0~9（kanzhun 字体 PUA 映射）
  function decodePuaSalary(text) {
    return Array.from(text || "").map((ch) => {
      const cp = ch.codePointAt(0);
      return cp >= 0xE031 && cp <= 0xE03A ? String(cp - 0xE031) : ch;
    }).join("");
  }

  // ---------- JD 提取（多级选择器容错） ----------
  function isJobDetailPage() {
    const u = location.href;
    if (/web\/geek\/jobs/.test(u)) return false;
    return /job_detail|jobDetail|web\/geek\/job[?/]|\/web\/geek\/job\b/.test(u);
  }

  // 职位列表页提取（web/geek/jobs 等）：取当前选中卡片，无选中取首张可见卡片
  function extractJobInfoFromListPage() {
    if (!/web\/geek\/jobs(?:\?|$)|web\/geek\/job\?/.test(location.href)) return null;
    const isVis = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const root = (() => {
      const act = document.querySelector(".job-card-wrap.active");
      if (act && isVis(act)) return act;
      return [...document.querySelectorAll("li.job-card-box")].filter(isVis)[0] || null;
    })();
    if (!root) return null;
    const title = pickText([".job-name", "a.job-name"], root) || "";
    const salary = decodePuaSalary((root.querySelector(".job-salary") || { textContent: "" }).textContent).trim();
    const company = pickText([".boss-info .boss-name", ".boss-name"], root);
    const tags = pickTextList([".tag-list li"], root).slice(0, 5);
    return { hasJd: !!title, title, salary, company, tags: tags.join("、"), desc: "" };
  }

  // ---------- 职位列表筛选（本地生效） ----------
  function parseCardData(li) {
    const title = pickText([".job-name", "a.job-name"], li) || "";
    const salaryTxt = decodePuaSalary((li.querySelector(".job-salary") || { textContent: "" }).textContent);
    const mR = String(salaryTxt).match(/(\d+)\s*[-~—至]\s*(\d+)\s*[Kk]/);
    return {
      title,
      company: pickText([".boss-info .boss-name", ".boss-name"], li) || "",
      tags: pickTextList([".tag-list li"], li).join(" "),
      salMin: mR ? Number(mR[1]) : 0,
      salMax: mR ? Number(mR[2]) : 0
    };
  }

  function applyJobFilter() {
    const f = filterState;
    if (!f) return { total: 0, matched: 0, hidden: 0 };
    let total = 0, matched = 0;
    for (const li of document.querySelectorAll("li.job-card-box")) {
      if (!isVisible(li)) continue;
      total++;
      const d = parseCardData(li);
      const kw = (d.title + " " + (d.company || "") + " " + (d.tags || "")).toLowerCase();
      const ok =
        (f.minK <= 0 || d.salMax >= f.minK) &&
        (f.maxK <= 0 || (d.salMin > 0 && d.salMin <= f.maxK)) &&
        f.incKw.every((k) => kw.includes(k)) &&
        !f.excKw.some((k) => kw.includes(k)) &&
        !f.excCompanies.some((k) => (d.company || "").includes(k));
      li.classList.toggle("ajf-hidden", !ok);
      if (ok) matched++;
    }
    return { total, matched, hidden: total - matched };
  }

  function enableFilterObserver() {
    if (window.__ajfObserver) return;
    const obs = new MutationObserver(() => {
      if (filterState) applyJobFilter();
    });
    obs.observe(document.body, { childList: true, subtree: true });
    window.__ajfObserver = obs;
  }

  function ensureFilterStyle() {
    if (document.getElementById("ajf-style")) return;
    const st = document.createElement("style");
    st.id = "ajf-style";
    st.textContent = "li.job-card-box.ajf-hidden { display: none !important; }";
    (document.head || document.documentElement).appendChild(st);
  }

  function setJobFilter(f) {
    ensureFilterStyle();
    filterState = {
      minK: Math.max(0, Number(f.minK) || 0),
      maxK: Math.max(0, Number(f.maxK) || 0),
      incKw: String(f.includeKw || "").split(/[,，\n]/).map((s) => s.trim().toLowerCase()).filter(Boolean),
      excKw: String(f.excludeKw || "").split(/[,，\n]/).map((s) => s.trim().toLowerCase()).filter(Boolean),
      excCompanies: String(f.excludeCompanies || "").split(/[,，\n]/).map((s) => s.trim()).filter(Boolean)
    };
    const active = filterState.minK || filterState.maxK || filterState.incKw.length || filterState.excKw.length || filterState.excCompanies.length;
    if (!active) { filterState = null; return { total: 0, matched: 0, hidden: 0, cleared: true }; }
    enableFilterObserver();
    return applyJobFilter();
  }

  function clearJobFilter() {
    filterState = null;
    document.querySelectorAll("li.job-card-box.ajf-hidden").forEach((li) => li.classList.remove("ajf-hidden"));
    return { ok: true };
  }

  function extractJobInfo() {
    const listJd = extractJobInfoFromListPage();
    if (listJd) return listJd;
    const EX = ":not([class*='similar']):not([class*='guide'])";

    const title = pickText([
      "h1" + EX, ".name .job-title", ".info-primary .name", ".job-title" + EX, "[class*='job-title']" + EX
    ]).replace(/\s*\d+[Kk万]?\d*[Kk万]?$/, "");

    const salary = pickText([
      ".info-primary .salary", ".salary" + EX, ".name .badge", "[class*='salary']" + EX, ".badge"
    ]);

    const company = pickText([
      ".job-detail-company li.company-name", "li.company-name" + EX,
      ".company-info-box .company-name", ".company-name" + EX,
      ".company-logo-name", "[class*='company-name']" + EX, ".company-info a", ".company-info .name", ".company-info"
    ]).replace(/^(公司名称|企业名称)\s*/i, "");

    const tags = pickTextList([
      ".job-tags span", ".tag-list span", "[class*='job-tags'] span", "[class*='tag-list'] span",
      ".job-limit span", ".job-keyword-list span"
    ]);

    const desc = pickText([
      ".job-detail .job-sec-text", ".job-detail-section .job-sec-text", ".job-sec-text" + EX,
      "[class*='job-sec-text']" + EX, ".job-detail .text", ".job-description"
    ]);

    const onDetail = isJobDetailPage() || !!document.querySelector(".job-detail:not([class*='guide']), .job-primary.detail-box");
    const hasJd = onDetail && !!(title && (desc || salary));
    return { hasJd, title, salary, company, tags: tags.join("、"), desc };
  }

  // ---------- 聊天消息采集 ----------
  function messageSelector() {
    const s = getSettings();
    return s.msgSelector ? [s.msgSelector] : [".msg-item", ".im-list .message-item", ".message-item", "[class*='msg-item']", ".chat-msg", "[class*='chatMsg']"];
  }

  function collectMsgNodes() {
    for (const sel of messageSelector()) {
      const nodes = $all(sel).filter(isVisible);
      if (nodes.length) return nodes;
    }
    return [];
  }

  function isVisible(el) {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function isSelfMsg(el) {
    const cls = (typeof el.className === "string" ? el.className : "") + " " +
      Array.from(el.querySelectorAll("*")).slice(0, 8).map((e) => (typeof e.className === "string" ? e.className : "")).join(" ");
    if (/other|to_me|from-boss|recruiter|friend/i.test(cls) && !/self|mine|my-msg/i.test(cls)) return false;
    if (/self|mine|my-msg|my_msg/i.test(cls)) return true;
    const item = el.closest("[class*='msg']");
    const container = item ? item.parentElement : el.parentElement;
    if (container && container.className && /self|mine/i.test(container.className)) return true;
    return false;
  }

  function msgText(el) {
    const t = el.querySelector(".msg-text, [class*='msg-text'], .chat-text, .text, [class*='msgText'], [class*='text']");
    if (t && t.textContent.trim()) return t.textContent.trim().replace(/\s+/g, " ");
    return el.textContent.trim().replace(/\s+/g, " ");
  }

  function isSystemMsg(el) {
    const t = msgText(el);
    return !t || /已读|以上为打招呼|自动|对方已|你已|温馨提示|投诉|举报|职位已关闭|该职位/i.test(t);
  }

  function isProcessedMsg(el) {
    return el.dataset && el.dataset.aiProcessed === "1";
  }

  function markProcessed(el) {
    if (el.dataset) el.dataset.aiProcessed = "1";
  }

  // ---------- 输入框 ----------
  function findInputBox() {
    const sels = [
      ".chat-input[contenteditable='true']",
      "[contenteditable='true'][data-placeholder]",
      ".chat-input textarea",
      ".chat-input input",
      "textarea[placeholder*='请输入']",
      ".chat-footer [contenteditable='true']",
      ".chat-footer textarea",
      "textarea",
      "[contenteditable='true']"
    ];
    const visible = $all("textarea, input, [contenteditable='true']").filter(isVisible);
    if (!visible.length) return null;
    for (const sel of sels) {
      const match = visible.find((el) => {
        const ok = sel.includes("[contenteditable='true']")
          ? el.matches(sel)
          : el.matches(sel);
        return ok;
      });
      if (match) return match;
    }
    return visible[visible.length - 1];
  }

  function setInputText(input, text) {
    if (!input) return false;
    if (input.tagName === "TEXTAREA" || input.tagName === "INPUT") {
      const proto = input.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value");
      if (setter && setter.set) setter.set.call(input, text);
      else input.value = text;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    } else {
      input.focus();
      input.textContent = "";
      input.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertText", data: text }));
      document.execCommand("insertText", false, text);
    }
    return true;
  }

  // ---------- 聊天会话上下文（面试准备用） ----------
  function extractChatContext() {
    const conv = document.querySelector(".chat-conversation");
    if (!conv) return null;
    const pick = (sel) => {
      const el = conv.querySelector(sel);
      return el && el.textContent ? el.textContent.trim().replace(/\s+/g, " ") : "";
    };
    const hrName = pick(".base-info .name-text");
    const company = (() => {
      const spans = [...conv.querySelectorAll(".base-info > span")].map((s) => s.textContent.trim()).filter(Boolean);
      return spans.find((t) => !/人事|招聘|主管|经理|专员|HR/.test(t)) || spans[0] || "";
    })();
    const title = (() => {
      const t = conv.querySelector(".position-name") ||
        conv.querySelector("a[href*='job_detail']");
      if (!t) return "";
      return t.textContent.trim().replace(/\s+/g, " ").replace(/\d+[Kk万]\d*[Kk万]?.*$/, "").trim();
    })();
    const salary = (() => {
      const m = (conv.innerText || "").match(/\d+[Kk]\s*[-~—至]\s*\d+[Kk万]?/);
      return m ? m[0].replace(/\s/g, "") : "";
    })();
    const jd = extractJobInfo();
    return { hrName, company, title, salary, jdDesc: jd.desc };
  }

  // ---------- 生成（统一走多智能体编排：GreetingAgent v4 / ReplyAgent v2） ----------
  function callAgentGenerate(payload) {
    return chrome.runtime.sendMessage({ type: "generate-agent", ...payload }).then((res) => {
      if (!res || !res.ok) throw new Error((res && res.error) || "生成失败，请检查配置");
      return res;
    });
  }

  function splitVersions(text) {
    const t = (text || "").trim();
    if (!t) return [];
    const marker = /^\s*(?:【\s*(?:版本\s*)?[0-9一二三四五六七八九十]+\s*】|版本\s*[0-9一二三四五六七八九十]+\s*[：:、.．]?|第\s*[0-9一二三四五六七八九十]+\s*(?:个版本|版)\s*[：:、.．]?|[0-9一二三四五六七八九十]+\s*[、.．:：])\s*/;
    const versions = [];
    let cur = "";
    for (const line of t.split(/\r?\n/)) {
      const m = line.match(marker);
      if (m) {
        if (cur) versions.push(cur.trim());
        cur = line.slice(m[0].length).trim();
      } else {
        cur += (cur ? "\n" : "") + line;
      }
    }
    if (cur) versions.push(cur.trim());
    const list = versions.filter(Boolean);
    if (list.length >= 2) return list;
    const lines = t.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    return lines.length >= 2 ? lines : [t];
  }

  async function generateGreeting() {
    const jd = extractJobInfo();
    if (!jd.hasJd) throw new Error("未识别到职位信息，请先打开职位详情页");
    const res = await callAgentGenerate({ kind: "greeting", jd });
    const versions = splitVersions(res.text);
    saveHistory({ kind: "greeting", title: jd.title, company: jd.company, result: res.text });
    await savePendingGreeting({
      versions,
      job: { title: jd.title, company: jd.company, salary: jd.salary },
      ts: Date.now()
    });
    return { jd, versions };
  }

  async function generateReply() {
    const jd = extractJobInfo();
    const history = collectConversation();
    const last = history.filter((h) => !h.self).pop();
    if (!last) throw new Error("未检测到对方的消息");
    const res = await callAgentGenerate({ kind: "reply", jd, history });
    saveHistory({ kind: "reply", title: jd.title, company: jd.company, result: res.text });
    return { jd, reply: res.text, lastMsg: last.text };
  }

  function collectConversation() {
    const nodes = collectMsgNodes();
    const list = [];
    for (const el of nodes) {
      const isSys = isSystemMsg(el);
      const self = isSelfMsg(el);
      const t = msgText(el);
      if (isSys || !t) continue;
      list.push({ self, text: t });
    }
    return list.slice(-Math.max(2, getSettings().maxContext || 8));
  }

  function saveHistory(entry) {
    chrome.storage.local.get("bossAiHistory").then((d) => {
      const list = d.bossAiHistory || [];
      entry.ts = Date.now();
      list.unshift(entry);
      if (list.length > HISTORY_CAP) list.length = HISTORY_CAP;
      chrome.storage.local.set({ bossAiHistory: list });
    });
  }

  // ---------- 跨页面待发送招呼语（local 存储，所有上下文可访问） ----------
  const PENDING_KEY = "bossAiPendingGreeting";

  async function getPendingGreeting() {
    const d = await chrome.storage.local.get(PENDING_KEY);
    return d[PENDING_KEY] || null;
  }
  function savePendingGreeting(data) {
    return chrome.storage.local.set({ [PENDING_KEY]: data }).catch((e) => console.error("[BOSS AI] 保存待发送招呼语失败:", e));
  }
  function clearPendingGreeting() {
    return chrome.storage.local.remove(PENDING_KEY);
  }

  // ---------- 悬浮组件 (Shadow DOM) ----------
  const widgetHost = document.createElement("div");
  widgetHost.id = "boss-ai-helper-host";
  widgetHost.style.all = "initial";
  document.documentElement.appendChild(widgetHost);

  const shadow = widgetHost.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; margin: 0; padding: 0; font-family: "Microsoft YaHei", "PingFang SC", sans-serif; }
      .fab { position: fixed; right: 24px; bottom: 90px; z-index: 2147483647; width: 52px; height: 52px; border-radius: 50%;
             background: linear-gradient(135deg, #1e6fff, #0b4fd6); color: #fff; border: none; cursor: pointer;
             box-shadow: 0 4px 16px rgba(14, 80, 214, .45); font-size: 22px; display: flex; align-items: center; justify-content: center;
             transition: transform .15s; }
      .fab:hover { transform: scale(1.08); }
      .panel { position: fixed; right: 24px; bottom: 152px; z-index: 2147483647; width: 380px; max-height: 520px; display: none;
               flex-direction: column; background: #fff; border-radius: 14px; box-shadow: 0 10px 40px rgba(0,0,0,.22);
               border: 1px solid #e4e8f0; overflow: hidden; font-size: 13px; }
      .panel.open { display: flex; }
      .head { background: linear-gradient(135deg, #1e6fff, #0b4fd6); color: #fff; padding: 12px 14px; display: flex; justify-content: space-between; align-items: center; }
      .head .t { font-weight: 700; font-size: 14px; }
      .head .close { background: none; border: none; color: #fff; font-size: 18px; cursor: pointer; line-height: 1; }
      .body { padding: 12px; overflow-y: auto; flex: 1; }
      .row { display: flex; gap: 8px; margin-bottom: 10px; }
      .btn { flex: 1; padding: 9px 0; border: none; border-radius: 8px; cursor: pointer; font-size: 13px; font-weight: 600; }
      .btn.primary { background: #1e6fff; color: #fff; }
      .btn.primary:hover { background: #0b4fd6; }
      .btn.ghost { background: #f2f5fa; color: #345; }
      .btn.ghost:hover { background: #e6ebf3; }
      .btn:disabled { opacity: .55; cursor: not-allowed; }
      .status { color: #889; font-size: 12px; padding: 6px 2px; }
      .status.err { color: #d63031; }
      .jd-box { background: #f7f9fc; border: 1px solid #eef1f6; border-radius: 8px; padding: 8px 10px; margin-bottom: 10px; font-size: 12px; color: #556; }
      .jd-box b { color: #1e6fff; }
      .ver { border: 1px solid #e4e8f0; border-radius: 10px; padding: 10px; margin-bottom: 10px; background: #fcfdff; }
      .ver .tag { display: inline-block; background: #eaf1ff; color: #1e6fff; border-radius: 4px; font-size: 11px; padding: 1px 6px; margin-bottom: 6px; }
      .ver .txt { line-height: 1.7; color: #223; white-space: pre-wrap; word-break: break-word; }
      .ver .ops { display: flex; gap: 6px; margin-top: 8px; }
      .mini { flex: 1; padding: 5px 0; font-size: 12px; border-radius: 6px; border: 1px solid #cfd8e6; background: #fff; color: #345; cursor: pointer; }
      .mini:hover { border-color: #1e6fff; color: #1e6fff; }
      .mini.fill { background: #1e6fff; border-color: #1e6fff; color: #fff; }
      .notif { position: fixed; right: 24px; bottom: 152px; z-index: 2147483647; width: 340px; background: #fff; border-radius: 12px;
               box-shadow: 0 10px 36px rgba(0,0,0,.25); border: 1px solid #e4e8f0; padding: 12px; display: none; }
      .notif.open { display: block; }
      .notif .n-title { font-weight: 700; font-size: 13px; margin-bottom: 6px; color: #1e6fff; }
      .notif .n-sub { font-size: 12px; color: #889; margin-bottom: 8px; }
      .notif .n-btns { display: flex; gap: 8px; }
      .spinner { display: inline-block; width: 12px; height: 12px; border: 2px solid #cfd8e6; border-top-color: #1e6fff; border-radius: 50%; animation: spin .8s linear infinite; vertical-align: -2px; margin-right: 6px; }
      @keyframes spin { to { transform: rotate(360deg); } }
      .foot { padding: 8px 12px; border-top: 1px solid #eef1f6; color: #99a; font-size: 11px; text-align: center; cursor: pointer; }
      .foot:hover { color: #1e6fff; }
      .pending-box { border: 1px dashed #1e6fff; background: #f3f8ff; border-radius: 10px; padding: 8px 10px; margin-bottom: 10px; }
      .pending-title { font-size: 12px; font-weight: 700; color: #1e6fff; margin-bottom: 6px; }
      .fab-dot { position: absolute; top: 4px; right: 4px; width: 12px; height: 12px; border-radius: 50%; background: #ff4757; border: 2px solid #fff; }
    </style>
    <button class="fab" title="BOSS AI 助手">AI<span class="fab-dot" data-el="fabDot" style="display:none"></span></button>
    <div class="panel">
      <div class="head"><span class="t">AI 沟通助手</span><button class="close">×</button></div>
      <div class="body">
        <div class="status hint"></div>
        <div data-el="pendingBox" class="pending-box" style="display:none;">
          <div class="pending-title" data-el="pendingTitle"></div>
          <div data-el="pendingList"></div>
        </div>
        <div class="row">
          <button class="btn primary" data-act="greeting">生成招呼语</button>
          <button class="btn ghost" data-act="reply">生成回复</button>
        </div>
        <div class="row">
          <button class="btn ghost" data-act="open-panel" style="width:100%">打开操作台（跨页面常驻）</button>
        </div>
        <div class="status" data-el="status"></div>
        <div data-el="content"></div>
      </div>
      <div class="foot" data-act="options">打开设置页</div>
    </div>
    <div class="notif">
      <div class="n-title">对方发来新消息</div>
      <div class="n-sub" data-el="nsub"></div>
      <div class="n-btns">
        <button class="btn primary" data-act="gen-reply">生成回复</button>
        <button class="btn ghost" data-act="dismiss">忽略</button>
      </div>
    </div>
  `;

  const els = {
    fab: shadow.querySelector(".fab"),
    panel: shadow.querySelector(".panel"),
    close: shadow.querySelector(".close"),
    status: shadow.querySelector('[data-el="status"]'),
    content: shadow.querySelector('[data-el="content"]'),
    hint: shadow.querySelector(".hint"),
    notif: shadow.querySelector(".notif"),
    nsub: shadow.querySelector('[data-el="nsub"]'),
    foot: shadow.querySelector(".foot"),
    pendingBox: shadow.querySelector('[data-el="pendingBox"]'),
    pendingTitle: shadow.querySelector('[data-el="pendingTitle"]'),
    pendingList: shadow.querySelector('[data-el="pendingList"]'),
    fabDot: shadow.querySelector('[data-el="fabDot"]')
  };

  function setStatus(text, isErr) {
    els.status.textContent = text || "";
    els.status.className = "status" + (isErr ? " err" : "");
  }

  function showHint() {
    const s = getSettings();
    const jd = extractJobInfo();
    const parts = [];
    parts.push(s.resumeText ? "简历 ●" : "简历 ○");
    parts.push(s.apiKey ? "API Key ●" : "API Key ○");
    parts.push(jd.hasJd ? "已识别JD ●" : "未识别到JD");
    els.hint.textContent = parts.join("  ·  ") + "（在设置页配置）";
    els.hint.style.cursor = "pointer";
  }

  function renderGreeting(res) {
    const c = els.content;
    c.innerHTML = "";
    const jdBox = document.createElement("div");
    jdBox.className = "jd-box";
    jdBox.innerHTML = "<b>" + (res.jd.title || "职位") + "</b>" +
      (res.jd.salary ? " · " + res.jd.salary : "") +
      (res.jd.company ? " · " + res.jd.company : "") +
      "<br>" + (res.jd.desc ? truncate(res.jd.desc, 120) : "未获取到职位描述");
    c.appendChild(jdBox);
    res.versions.forEach((v, i) => c.appendChild(versionCard("招呼语 " + (i + 1), v, "greeting")));
  }

  function versionCard(tag, text, kind) {
    const card = document.createElement("div");
    card.className = "ver";
    card.innerHTML = '<span class="tag">' + tag + "</span><div class='txt'></div><div class='ops'></div>";
    card.querySelector(".txt").textContent = text;
    const ops = card.querySelector(".ops");
    const fill = document.createElement("button");
    fill.className = "mini fill";
    fill.textContent = isChatPage() ? "填入输入框" : "去聊天并填入";
    fill.onclick = () => {
      if (isChatPage()) fillInput(text, kind);
      else goChatAndFill(text);
    };
    const copy = document.createElement("button");
    copy.className = "mini";
    copy.textContent = "复制";
    copy.onclick = () => {
      navigator.clipboard.writeText(text).then(() => { copy.textContent = "已复制 ✓"; setTimeout(() => (copy.textContent = "复制"), 1200); });
    };
    const regen = document.createElement("button");
    regen.className = "mini";
    regen.textContent = "换一条";
    regen.onclick = () => runAction(kind === "greeting" ? "greeting" : "reply");
    ops.appendChild(fill);
    ops.appendChild(copy);
    ops.appendChild(regen);
    return card;
  }

  function renderReply(res) {
    const c = els.content;
    c.innerHTML = "";
    const jdBox = document.createElement("div");
    jdBox.className = "jd-box";
    jdBox.innerHTML = "<b>对方：</b>" + truncate(res.lastMsg, 80) + "<br>" +
      "<b>职位：</b>" + (res.jd.title || "未知");
    c.appendChild(jdBox);
    c.appendChild(versionCard("AI 回复", res.reply, "reply"));
  }

  async function renderPending() {
    const data = await getPendingGreeting();
    const has = !!(data && data.versions && data.versions.length);
    els.fabDot.style.display = has ? "block" : "none";
    if (!has) {
      els.pendingBox.style.display = "none";
      els.pendingList.innerHTML = "";
      return;
    }
    const job = data.job || {};
    els.pendingTitle.textContent = "待发送招呼语 · " +
      (job.title || "职位") + (job.salary ? " " + job.salary : "") +
      (job.company ? " · " + job.company : "");
    els.pendingList.innerHTML = "";
    data.versions.forEach((v, i) => {
      els.pendingList.appendChild(versionCard("招呼语 " + (i + 1), v, "greeting"));
    });
    const discard = document.createElement("button");
    discard.className = "mini";
    discard.textContent = "丢弃全部";
    discard.style.width = "100%";
    discard.style.marginTop = "4px";
    discard.onclick = () => {
      clearPendingGreeting().then(() => {
        els.pendingBox.style.display = "none";
        els.pendingList.innerHTML = "";
        els.fabDot.style.display = "none";
        setStatus("");
      });
    };
    els.pendingList.appendChild(discard);
    els.pendingBox.style.display = "block";
  }

  async function runAction(kind) {
    await loadSettings();
    const s = getSettings();
    if (!s.apiKey) {
      setStatus("未配置 API Key，请先打开设置页填写", true);
      return;
    }
    if (kind === "greeting" && !s.resumeText) {
      setStatus("未配置简历，生成效果会变差，建议先在设置页上传简历", true);
    }
    els.content.innerHTML = "";
    setStatus("");
    els.status.innerHTML = '<span class="spinner"></span>正在生成…';
    try {
      const res = kind === "greeting" ? await generateGreeting() : await generateReply();
      els.status.textContent = "";
      if (kind === "greeting") {
        renderGreeting(res);
        renderPending();
      } else {
        renderReply(res);
      }
    } catch (err) {
      setStatus(String(err.message || err), true);
    }
  }

  function fillInput(text, kind) {
    const input = findInputBox();
    if (!input) {
      setStatus("未找到聊天输入框，请打开聊天窗口后重试", true);
      return;
    }
    if (!setInputText(input, text)) {
      setStatus("填入失败，请手动复制粘贴", true);
      return;
    }
    setStatus("已填入输入框，确认后点击发送");
    if (kind === "greeting") {
      clearPendingGreeting().then(renderPending);
      const sendBtn = findSendButton();
      if (sendBtn) sendBtn.scrollIntoView({ block: "nearest" });
    }
    els.notif.classList.remove("open");
  }

  function findSendButton() {
    const visible = $all("button").filter(isVisible);
    return visible.find((b) => /发送|^send$/i.test(b.textContent.trim()) && b.textContent.trim().length <= 4) || null;
  }

  // ---------- 一键「去聊天并填入」 ----------
  function isChatPage() {
    return /web\/geek\/chat/.test(location.href);
  }

  function findChatEntryEl() {
    const visible = $all("a, button").filter(isVisible);
    return (
      visible.find((el) => /btn-startchat|startchat/i.test(typeof el.className === "string" ? el.className : "")) ||
      visible.find((el) => {
        const t = el.textContent.trim().replace(/\s+/g, "");
        return /立即沟通|和TA聊|在线沟通/.test(t) && t.length <= 12;
      }) ||
      null
    );
  }

  const AUTOFILL_KEY = "bossAiAutoFill";

  async function goChatAndFill(text) {
    await chrome.storage.local.set({ [AUTOFILL_KEY]: { text, ts: Date.now() } });
    const entry = findChatEntryEl();
    if (entry) {
      entry.click();
    }
    setTimeout(() => {
      if (!isChatPage()) location.href = "https://www.zhipin.com/web/geek/chat";
    }, 1800);
  }

  async function autoFillFromMarker() {
    if (!isChatPage()) return;
    const d = await chrome.storage.local.get(AUTOFILL_KEY);
    const m = d[AUTOFILL_KEY];
    if (!m || !m.text) return;
    const t0 = Date.now();
    while (Date.now() - t0 < 20000) {
      const input = findInputBox();
      if (input) {
        const ok = setInputText(input, m.text);
        await chrome.storage.local.remove(AUTOFILL_KEY);
        if (ok) {
          clearPendingGreeting().then(renderPending);
          setStatus("已自动填入输入框，确认后点发送");
          const sb = findSendButton();
          if (sb) sb.scrollIntoView({ block: "nearest" });
        }
        return;
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
    await chrome.storage.local.remove(AUTOFILL_KEY);
  }

  // ---------- 聊天监听 ----------
  let pendingLastMsg = "";
  let lastNotifyTs = 0;

  function onNewIncomingMsg() {
    const s = getSettings();
    if (!s.autoReply) return;
    const nodes = collectMsgNodes();
    if (!nodes.length) return;
    const last = nodes[nodes.length - 1];
    if (isProcessedMsg(last)) return;
    if (isSelfMsg(last) || isSystemMsg(last)) {
      markProcessed(last);
      return;
    }
    markProcessed(last);
    const text = msgText(last);
    if (!text) return;
    const now = Date.now();
    if (text === pendingLastMsg || now - lastNotifyTs < (s.cooldown || 10) * 1000) return;
    pendingLastMsg = text;
    lastNotifyTs = now;

    els.nsub.textContent = truncate(text, 60);
    els.notif.classList.add("open");
    const jd = extractJobInfo();
    els.notif.dataset.job = JSON.stringify({ title: jd.title, company: jd.company, salary: jd.salary, desc: jd.desc, tags: jd.tags });
    if (s.notifySound) beep();
  }

  function beep() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.frequency.value = 880; g.gain.value = 0.08;
      o.start(); o.stop(ctx.currentTime + 0.15);
    } catch (e) {}
  }

  let observer = null;
  function startObserving() {
    if (observer) return;
    observer = new MutationObserver(() => {
      const nodes = collectMsgNodes();
      if (nodes.length) onNewIncomingMsg();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ---------- 事件绑定 ----------
  els.fab.addEventListener("click", () => {
    const open = els.panel.classList.toggle("open");
    if (open) {
      showHint();
      renderPending();
      els.content.innerHTML = "";
      setStatus("");
    }
  });
  els.close.addEventListener("click", () => els.panel.classList.remove("open"));
  els.panel.addEventListener("click", (e) => {
    const act = e.target.closest("[data-act]");
    if (!act) return;
    const a = act.dataset.act;
    if (a === "greeting" || a === "reply") runAction(a);
    if (a === "options") chrome.runtime.sendMessage({ type: "openOptions" });
    if (a === "open-panel") chrome.runtime.sendMessage({ type: "openPanel" });
  });

  // ---------- 操作台消息桥（面板窗口 ≈ 当前页） ----------
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || !msg.type) return;
    if (msg.type === "getJd") {
      sendResponse({ jd: extractJobInfo() });
    } else if (msg.type === "generate-now") {
      loadSettings().then(() => {
        const run = msg.kind === "greeting" ? generateGreeting() : generateReply();
        run.then((res) => sendResponse({ ok: true, res }))
           .catch((err) => sendResponse({ ok: false, error: String(err.message || err) }));
      });
      return true;
    } else if (msg.type === "fill-input") {
      const input = findInputBox();
      if (!input) { sendResponse({ ok: false, error: "未找到聊天输入框，请打开聊天窗口" }); return; }
      const ok = setInputText(input, msg.text);
      if (ok && msg.kind === "greeting") clearPendingGreeting().then(renderPending);
      sendResponse({ ok, error: ok ? "" : "填入失败，请手动复制粘贴" });
    } else if (msg.type === "get-chat-context") {
      sendResponse({ ok: true, ctx: extractChatContext() });
    } else if (msg.type === "goto-chat-and-fill") {
      goChatAndFill(msg.text).then(() => sendResponse({ ok: true }));
      return true;
    } else if (msg.type === "panel-status") {
      loadSettings().then(() => {
        const s = getSettings();
        const jd = extractJobInfo();
        getPendingGreeting().then((p) => sendResponse({
          ok: true,
          status: {
            resume: !!s.resumeText,
            apiKey: !!s.apiKey,
            onDetail: jd.hasJd,
            autoReply: s.autoReply,
            pending: !!(p && p.versions && p.versions.length)
          }
        }));
      });
      return true;
    } else if (msg.type === "apply-filter") {
      const r = setJobFilter(msg.filter || {});
      sendResponse({ ok: true, ...r });
    } else if (msg.type === "clear-filter") {
      clearJobFilter();
      sendResponse({ ok: true });
    } else if (msg.type === "collect-match-jobs") {
      const isVis = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      const rows = [];
      for (const li of document.querySelectorAll("li.job-card-box")) {
        if (!isVis(li)) continue;
        const a = li.querySelector("a.job-name");
        const href = a ? (a.getAttribute("href") || "") : "";
        const id = (/\/job_detail\/([^./]+)\.html/.exec(href) || [])[1] || href;
        const title = pickText([".job-name", "a.job-name"], li) || "";
        if (!title) continue;
        const salaryTxt = decodePuaSalary((li.querySelector(".job-salary") || { textContent: "" }).textContent);
        const mR = String(salaryTxt).match(/(\d+)\s*[-~—至]\s*(\d+)\s*[Kk]/);
        rows.push({
          id,
          title,
          salary: String(salaryTxt).trim(),
          salaryMin: mR ? Number(mR[1]) : 0,
          salaryMax: mR ? Number(mR[2]) : 0,
          company: pickText([".boss-info .boss-name", ".boss-name"], li) || "",
          tags: pickTextList([".tag-list li"], li).join("、"),
          href: href
        });
      }
      sendResponse({ ok: rows.length > 0, total: rows.length, rows });
    }
  });
  els.notif.addEventListener("click", (e) => {
    const act = e.target.closest("[data-act]");
    if (!act) return;
    if (act.dataset.act === "dismiss") {
      els.notif.classList.remove("open");
      return;
    }
    if (act.dataset.act === "gen-reply") {
      els.notif.classList.remove("open");
      els.panel.classList.add("open");
      runAction("reply");
    }
  });
  els.hint.addEventListener("click", () => chrome.runtime.sendMessage({ type: "openOptions" }));

  // ---------- 初始化 ----------
  (async () => {
    await loadSettings();
    startObserving();
    autoFillFromMarker();
    setTimeout(() => {
      showHint();
      renderPending();
      onNewIncomingMsg();
    }, 800);
  })();
})();
