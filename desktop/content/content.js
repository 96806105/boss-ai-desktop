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
    return settings || (settings = { apiKey: "", model: "deepseek-chat", style: "prof", customPrompt: "", resumeText: "", resumeFileName: "", resumes: [], activeResumeId: "", autoReply: true, cooldown: 10, maxContext: 8, msgSelector: "", notifySound: false });
  }

  /** 当前生效的简历文本（多简历：优先 activeResumeId，回退旧 resumeText） */
  function hasResumeText(s) {
    const list = Array.isArray(s.resumes) ? s.resumes : [];
    const active = list.find((r) => r && r.id === s.activeResumeId) || list[0];
    if (active && String(active.text || "").trim()) return true;
    return !!String(s.resumeText || "").trim();
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
      resumes: Array.isArray(s.resumes) ? s.resumes : [],
      activeResumeId: s.activeResumeId || "",
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

  // ---------- 新版聊天页 API 提取（BOSS 新版 DOM 无职位卡片，走官方接口） ----------
  async function fetchFriendList() {
    try {
      const r = await fetch("https://www.zhipin.com/wapi/zprelation/friend/geekFilterByLabel?labelId=0", {
        credentials: "include",
        headers: { "Accept": "application/json" }
      });
      if (!r.ok) return [];
      const j = await r.json();
      const list = (j && j.zpData && j.zpData.friendList) || [];
      return list.map((f) => ({
        friendId: f.friendId,
        encryptFriendId: f.encryptFriendId,
        name: f.name || "",
        company: f.brandName || "",
        jobName: f.jobName || "",
        jobTypeDesc: f.jobTypeDesc || "",
        jobCity: f.jobCity || "",
        positionName: f.positionName || "",
        bossTitle: f.bossTitle || "",
        updateTime: f.updateTime || 0
      }));
    } catch (err) {
      return [];
    }
  }

  function jdFromFriends(friends) {
    if (!friends || !friends.length) return null;
    const top = friends.slice().sort((a, b) => (b.updateTime || 0) - (a.updateTime || 0))[0];
    return {
      hasJd: true,
      via: "api",
      title: top.jobName || top.positionName || "",
      company: top.company || "",
      salary: "",
      tags: [top.jobTypeDesc, top.jobCity, top.positionName, top.bossTitle].filter(Boolean).join("、"),
      desc: "",
      friendName: top.name || "",
      friends: friends
    };
  }

  async function extractJobInfoAsync() {
    const dom = extractJobInfo();
    if (dom && dom.hasJd) return dom;
    if (/web\/geek\/chat/.test(location.href)) {
      const friends = await fetchFriendList();
      const apiJd = jdFromFriends(friends);
      if (apiJd) return apiJd;
    }
    return dom;
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
      "#chat-input[contenteditable='true']",
      "[contenteditable='true'][data-placeholder]",
      ".chat-input textarea",
      ".chat-input input",
      "textarea[placeholder*='请输入']",
      ".chat-footer [contenteditable='true']",
      ".chat-footer textarea",
      ".chat-conversation textarea, .chat-conversation [contenteditable='true']",
      "[class*='chat'] textarea, [class*='chat'] [contenteditable='true']"
    ];
    const visible = $all("textarea, input, [contenteditable='true']").filter(isVisible).filter((el) => {
      if (el.tagName === "INPUT") {
        const ph = (el.getAttribute("placeholder") || "") + " " + (el.className || "") + " " + (el.type || "");
        if (/(search|搜索|查询)/i.test(ph)) return false;
      }
      return true;
    });
    if (!visible.length) return null;
    for (const sel of sels) {
      const match = visible.find((el) => el.matches(sel));
      if (match) return match;
    }
    return null;
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
      .img-bank { border: 1px solid #e4e8f0; border-radius: 10px; padding: 8px; margin-bottom: 10px; }
      .img-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
      .img-title { font-size: 12px; font-weight: 700; color: #345; }
      .img-add { background: #1e6fff; color: #fff; border: none; border-radius: 6px; font-size: 11px; padding: 3px 10px; cursor: pointer; }
      .img-add:hover { background: #0b4fd6; }
      .img-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
      .img-item { position: relative; border-radius: 8px; overflow: hidden; border: 1px solid #e4e8f0; cursor: pointer;
                   aspect-ratio: 3 / 4; background: #f2f5fa; }
      .img-item img { width: 100%; height: 100%; object-fit: cover; display: block; }
      .img-item:hover { border-color: #1e6fff; }
      .img-del { position: absolute; top: 2px; right: 2px; width: 16px; height: 16px; line-height: 14px; text-align: center;
                 border-radius: 50%; background: rgba(0,0,0,.55); color: #fff; font-size: 11px; border: none; cursor: pointer; display: none; }
      .img-item:hover .img-del { display: block; }
      .img-empty { color: #99a; font-size: 11px; text-align: center; padding: 6px 0; }
    </style>
    <button class="fab" title="BOSS AI 助手">AI<span class="fab-dot" data-el="fabDot" style="display:none"></span></button>
    <div class="panel">
      <div class="head"><span class="t">AI 沟通助手</span><button class="close">×</button></div>
      <div class="body">
        <div class="status hint"></div>
        <div class="img-bank">
          <div class="img-head"><span class="img-title">简历图片 · 点击发送</span><button class="img-add" data-act="pick-image">＋ 上传</button></div>
          <div data-el="imgGrid" class="img-grid"></div>
        </div>
        <div data-el="pendingBox" class="pending-box" style="display:none;">
          <div class="pending-title" data-el="pendingTitle"></div>
          <div data-el="pendingList"></div>
        </div>
        <div class="row">
          <button class="btn primary" data-act="greeting">生成招呼语</button>
          <button class="btn ghost" data-act="reply">生成回复</button>
        </div>
        <div class="row" data-el="stopRow" style="display:none;">
          <button class="btn ghost" data-act="cancel" style="width:100%; border:1px solid #d63031; color:#d63031;">停止生成</button>
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
    fabDot: shadow.querySelector('[data-el="fabDot"]'),
    stopRow: shadow.querySelector('[data-el="stopRow"]'),
    imgGrid: shadow.querySelector('[data-el="imgGrid"]')
  };

  function setStatus(text, isErr) {
    els.status.textContent = text || "";
    els.status.className = "status" + (isErr ? " err" : "");
  }

  function showHint() {
    const s = getSettings();
    const jd = extractJobInfo();
    const parts = [];
    parts.push(hasResumeText(s) ? "简历 ●" : "简历 ○");
    parts.push(s.apiKey ? "API Key ●" : "API Key ○");
    parts.push(jd.hasJd ? "已识别JD ●" : "未识别到JD");
    els.hint.textContent = parts.join("  ·  ") + "（在设置页配置）";
    els.hint.style.cursor = "pointer";
  }

  // ---------- 简历图片库 ----------
  async function renderImageBank() {
    const grid = els.imgGrid;
    let res = null;
    try { res = await chrome.runtime.sendMessage({ type: "list-images" }); } catch (e) {}
    const images = (res && res.images) || [];
    if (!images.length) { grid.innerHTML = '<div class="img-empty">还没有图片，点「＋ 上传」添加简历图</div>'; return; }
    grid.innerHTML = "";
    for (const it of images) {
      const box = document.createElement("div");
      box.className = "img-item";
      const img = document.createElement("img");
      img.alt = it.name || "简历图";
      const del = document.createElement("button");
      del.className = "img-del";
      del.textContent = "×";
      del.title = "删除";
      del.addEventListener("click", async (e) => {
        e.stopPropagation();
        try { await chrome.runtime.sendMessage({ type: "delete-image", id: it.id }); } catch (err) {}
        renderImageBank();
      });
      box.appendChild(img);
      box.appendChild(del);
      box.addEventListener("click", () => sendImage(it));
      grid.appendChild(box);
      chrome.runtime.sendMessage({ type: "read-image", id: it.id }).then((r) => { if (r && r.ok) img.src = r.dataUrl; }).catch(() => {});
    }
  }

  function findFileInput() {
    const all = Array.from(document.querySelectorAll('input[type="file"]'));
    const acc = (el) => (el.getAttribute("accept") || "").toLowerCase();
    return all.find((el) => acc(el).includes("image")) || all[0] || null;
  }

  function injectFile(input, dataUrl, fileName) {
    const mime = (dataUrl.match(/^data:([^;]+)/) || [])[1] || "image/png";
    const b64 = dataUrl.split(",")[1];
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const file = new File([bytes], fileName || "resume.png", { type: mime });
    const dt = new DataTransfer();
    dt.items.add(file);
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "files").set;
    setter.call(input, dt.files);
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  async function sendImage(it) {
    let res = null;
    try { res = await chrome.runtime.sendMessage({ type: "read-image", id: it.id }); } catch (e) {}
    if (!res || !res.ok) { setStatus("读取图片失败", true); return; }
    if (!isChatPage()) { setStatus("请先打开聊天窗口，再点击图片发送", true); return; }
    const input = findFileInput();
    if (!input) { setStatus("未找到图片上传入口，请手动点击输入框旁的图片按钮", true); return; }
    try {
      injectFile(input, res.dataUrl, it.name || "resume.png");
      setStatus("已注入上传入口，请确认图片后发送");
    } catch (e) { setStatus("发送失败：" + String((e && e.message) || e), true); }
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

  let widgetBusy = false;

  async function runAction(kind) {
    if (widgetBusy) return;
    await loadSettings();
    const s = getSettings();
    if (!s.apiKey) {
      setStatus("未配置 API Key，请先打开设置页填写", true);
      return;
    }
    if (kind === "greeting" && !hasResumeText(s)) {
      setStatus("未配置简历，生成效果会变差，建议先在设置页上传简历", true);
    }
    els.content.innerHTML = "";
    setStatus("");
    widgetBusy = true;
    els.stopRow.style.display = "block";
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
      const msg = String(err.message || err);
      if (/已停止|已取消/.test(msg)) setStatus("已停止生成");
      else setStatus(msg, true);
    } finally {
      widgetBusy = false;
      els.stopRow.style.display = "none";
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
    if (entry) entry.click();
    setTimeout(() => {
      if (!isChatPage()) location.href = "https://www.zhipin.com/web/geek/chat";
      else autoFillFromMarker();
    }, 1800);
  }

  async function autoFillFromMarker() {
    if (!isChatPage()) return;
    const d = await chrome.storage.local.get(AUTOFILL_KEY);
    const m = d[AUTOFILL_KEY];
    if (!m || !m.text) return;
    const t0 = Date.now();
    let openTried = false;
    while (Date.now() - t0 < 30000) {
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
      if (!openTried) {
        openTried = true;
        requestOpenFirstChat();
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
    await chrome.storage.local.remove(AUTOFILL_KEY);
  }

  /** 聊天列表页兜底：请主进程用真实输入事件点开第一条会话（BOSS 新版页面忽略合成 click） */
  function requestOpenFirstChat() {
    const rect = firstChatRect();
    if (!rect) return;
    try { chrome.runtime.sendMessage({ type: "desktop-open-first-chat", x: rect.x, y: rect.y }); } catch (e) {}
  }

  /** 第一个会话卡片的视口中心坐标 */
  function firstChatRect() {
    const wrap = $all(".friend-content-warp").filter(isVisible)[0];
    if (!wrap) return null;
    const r = (wrap.closest("li") || wrap).getBoundingClientRect();
    return { x: r.left + r.width / 2, y: Math.max(10, r.top + Math.min(r.height / 2, 60)) };
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

  // ---------- 清理已读不回（超过1天） ----------
  const CLEAN_DAY_MS = 24 * 60 * 60 * 1000;
  const CLEAN_INTERVAL_MS = 2500;

  function readZpToken() {
    const m = /(?:^|;\s*)bst=([^;]*)/.exec(document.cookie);
    return m ? m[1] : "";
  }

  function makeTraceId() {
    let t = Date.now().toString(16).toLowerCase().padStart(13, "0").slice(-13);
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let e = "";
    for (let n = 0; n < 36; n++) e += chars[Math.floor(62 * Math.random())];
    const base = "F-" + t + e;
    let hash = 0;
    for (let i = 0; i < base.length; i++) hash = (hash * 31 + base.charCodeAt(i)) >>> 0;
    return base + hash.toString(36);
  }

  async function cleanUnreadFlow() {
    setStatus("正在分析会话…");
    els.content.innerHTML = "";
    const r = await analyzeClean();
    if (!r.ok) { setStatus(r.error, true); return; }
    setStatus("");
    if (!r.count) { setStatus("没有找到超过1天未回的已读会话"); return; }
    renderCleanCandidates(r.candidates);
  }

  async function analyzeClean() {
    try {
      const my = await (await fetch("/wapi/zpuser/wap/getUserInfo.json")).json();
      const myUid = my && my.zpData && (my.zpData.uid || my.zpData.userId);
      if (!myUid) return { ok: false, error: "无法获取用户信息，请刷新后重试" };
      const r = await fetch("/wapi/zprelation/friend/getGeekFriendList.json", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "x-requested-with": "XMLHttpRequest" },
        body: "page=1&limit=100"
      });
      const j = await r.json();
      const list = (j.zpData && j.zpData.result) || [];
      const now = Date.now();
      const cand = list.filter((x) => (
        x.lastMessageInfo &&
        x.lastMessageInfo.fromId === myUid &&
        x.lastMessageInfo.status === 2 &&
        !x.unreadMsgCount &&
        !x.isTop &&
        x.lastTS && (now - x.lastTS > CLEAN_DAY_MS)
      ));
      return { ok: true, count: cand.length, candidates: cand };
    } catch (e) {
      return { ok: false, error: "分析失败：" + (e && e.message || e) };
    }
  }

  function renderCleanCandidates(cand) {
    const c = document.createElement("div");
    const t = document.createElement("div");
    t.style.cssText = "font-weight:700;color:#1e6fff;font-size:13px;margin-bottom:8px;";
    t.textContent = "发现 " + cand.length + " 个已读不回（>1天）的会话：";
    c.appendChild(t);
    const listEl = document.createElement("div");
    listEl.style.cssText = "max-height:240px;overflow-y:auto;border:1px solid #eef1f6;border-radius:8px;padding:6px;margin-bottom:10px;";
    cand.forEach((x) => {
      const row = document.createElement("div");
      row.style.cssText = "font-size:12px;color:#445;line-height:1.6;padding:5px 4px;border-bottom:1px dashed #eef1f6;";
      const when = x.lastTime || new Date(x.lastTS).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
      row.innerHTML = "<b>" + escHtml(x.name) + "</b> · " + escHtml(x.brandName || "") + " <span style='color:#99a'>" + when + "</span><br><span style='color:#778'>" + escHtml((x.lastMsg || "").slice(0, 40)) + "</span>";
      listEl.appendChild(row);
    });
    c.appendChild(listEl);
    const row2 = document.createElement("div");
    row2.style.cssText = "display:flex;gap:8px;";
    const okBtn = document.createElement("button");
    okBtn.className = "btn primary";
    okBtn.textContent = "确认删除 " + cand.length + " 条";
    const cancelBtn = document.createElement("button");
    cancelBtn.className = "btn ghost";
    cancelBtn.textContent = "取消";
    okBtn.addEventListener("click", () => executeClean(cand));
    cancelBtn.addEventListener("click", () => { els.content.innerHTML = ""; setStatus("已取消"); });
    row2.appendChild(okBtn);
    row2.appendChild(cancelBtn);
    c.appendChild(row2);
    els.content.appendChild(c);
  }

  async function executeClean(cand) {
    els.content.innerHTML = "";
    const r = await runClean(cand, (t) => setStatus(t));
    setStatus("完成：成功删除 " + r.okCount + " 条" + (r.skipCount ? "，跳过 " + r.skipCount : "") + (r.failCount ? "，失败 " + r.failCount : ""));
    if (r.fails.length) {
      const f = document.createElement("div");
      f.style.cssText = "font-size:12px;color:#d63031;line-height:1.6;margin-top:8px;";
      f.textContent = r.fails.join("；");
      els.content.appendChild(f);
    }
    if (r.okCount > 0) {
      const reload = document.createElement("button");
      reload.className = "btn primary";
      reload.style.cssText = "margin-top:10px;width:100%;";
      reload.textContent = "刷新列表";
      reload.addEventListener("click", () => location.reload());
      els.content.appendChild(reload);
    }
  }

  async function runClean(cand, onStatus) {
    const my = await (await fetch("/wapi/zpuser/wap/getUserInfo.json")).json();
    const myUid = my && my.zpData && (my.zpData.uid || my.zpData.userId);
    let okCount = 0, skipCount = 0, failCount = 0;
    const fails = [];
    for (let i = 0; i < cand.length; i++) {
      const x = cand[i];
      if (onStatus) onStatus("正在删除 (" + (i + 1) + "/" + cand.length + ") " + x.name);
      try {
        if (!x.securityId) { skipCount++; continue; }
        const g = await (await fetch("/wapi/zpchat/geek/getBossData?bossId=" + encodeURIComponent(x.encryptBossId) + "&bossSource=0")).json();
        const d = g.zpData && g.zpData.data;
        if (d && (d.hasInterview || d.isBlacked)) { skipCount++; continue; }
        const body = new URLSearchParams({ securityId: x.securityId });
        const dl = await (await fetch("/wapi/zprelation/friend/delete.json", {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "x-requested-with": "XMLHttpRequest",
            "zp_token": readZpToken(),
            "traceid": makeTraceId()
          },
          body: body.toString()
        })).json();
        if (dl.code === 0) okCount++;
        else { failCount++; fails.push(x.name + "(" + (dl.message || dl.code) + ")"); }
      } catch (e) {
        failCount++;
        fails.push(x.name + "(" + (e && e.message || e) + ")");
      }
      await new Promise((s) => setTimeout(s, CLEAN_INTERVAL_MS));
    }
    return { okCount, skipCount, failCount, fails };
  }

  function escHtml(s) {
    return String(s).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  }

  // ---------- 事件绑定 ----------
  els.fab.addEventListener("click", () => {
    const open = els.panel.classList.toggle("open");
    if (open) {
      showHint();
      renderPending();
      renderImageBank();
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
    if (a === "pick-image") {
      chrome.runtime.sendMessage({ type: "pick-image" }).then((r) => {
        if (r && r.ok) {
          if (r.canceled) return;
          setStatus("已上传 " + ((r.added && r.added.length) || 0) + " 张图片");
          renderImageBank();
        } else {
          setStatus("上传失败：" + ((r && r.error) || "未知错误"), true);
        }
      }).catch((err) => setStatus("上传失败：" + String((err && err.message) || err), true));
    }
    if (a === "cancel") {
      chrome.runtime.sendMessage({ type: "cancel" });
      setStatus("正在停止…");
    }
  });

  // ---------- 操作台消息桥（面板窗口 ≈ 当前页） ----------
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || !msg.type) return;
    if (msg.type === "getJd") {
      extractJobInfoAsync().then((jd) => sendResponse({ ok: true, jd }));
      return true;
    } else if (msg.type === "generate-now") {
      loadSettings().then(() => {
        const run = msg.kind === "greeting" ? generateGreeting() : generateReply();
        run.then((res) => sendResponse({ ok: true, res }))
           .catch((err) => sendResponse({ ok: false, error: String(err.message || err) }));
      });
      return true;
    } else if (msg.type === "fill-input") {
      if (!isChatPage()) { sendResponse({ ok: false, error: "未找到聊天输入框，请打开聊天窗口" }); return; }
      const input = findInputBox();
      if (!input) { sendResponse({ ok: false, error: "未找到聊天输入框，请打开聊天窗口" }); return; }
      const ok = setInputText(input, msg.text);
      if (ok && msg.kind === "greeting") clearPendingGreeting().then(renderPending);
      sendResponse({ ok, error: ok ? "" : "填入失败，请手动复制粘贴" });
    } else if (msg.type === "get-chat-context") {
      sendResponse({ ok: true, ctx: extractChatContext() });
    } else if (msg.type === "get-chat-history") {
      extractJobInfoAsync().then((jd) => sendResponse({ ok: true, jd, history: collectConversation() }));
      return true;
    } else if (msg.type === "goto-chat-and-fill") {
      goChatAndFill(msg.text).then(() => sendResponse({ ok: true }));
      return true;
    } else if (msg.type === "send-resume-image") {
      chrome.runtime.sendMessage({ type: "read-image", id: msg.id }).then((res) => {
        if (!res || !res.ok) { sendResponse({ ok: false, error: "图片不存在" }); return; }
        if (!isChatPage()) { sendResponse({ ok: false, error: "未找到聊天输入框，请打开聊天窗口" }); return; }
        const input = findFileInput();
        if (!input) { sendResponse({ ok: false, error: "未找到图片上传入口，请手动点击输入框旁的图片按钮" }); return; }
        try { injectFile(input, res.dataUrl, res.name || "resume.png"); sendResponse({ ok: true, sent: true }); }
        catch (e) { sendResponse({ ok: false, error: String((e && e.message) || e) }); }
      }).catch((e) => sendResponse({ ok: false, error: String((e && e.message) || e) }));
      return true;
    } else if (msg.type === "panel-status") {
      loadSettings().then(() => {
        const s = getSettings();
        extractJobInfoAsync().then((jd) => {
          getPendingGreeting().then((p) => sendResponse({
            ok: true,
            status: {
              resume: hasResumeText(s),
              apiKey: !!s.apiKey,
              onDetail: jd.hasJd,
              autoReply: s.autoReply,
              pending: !!(p && p.versions && p.versions.length)
            }
          }));
        });
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
    } else if (msg.type === "clean-unread-analyze") {
      analyzeClean().then((r) => sendResponse(r));
      return true;
    } else if (msg.type === "clean-unread-run") {
      const cand = Array.isArray(msg.candidates) ? msg.candidates : [];
      if (!cand.length) { sendResponse({ ok: false, error: "没有可删除的会话" }); return; }
      runClean(cand).then((r) => sendResponse({ ok: true, ...r }));
      return true;
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
