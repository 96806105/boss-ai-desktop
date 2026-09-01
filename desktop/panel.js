const api = window.panelApi;
const $ = (sel) => document.querySelector(sel);
const AGENT_ICONS = {
  greeting: "i-spark",
  reply: "i-chat",
  interview: "i-briefcase",
  company: "i-building",
  application: "i-file",
  match: "i-target",
  chat: "i-chat"
};

let settings = null;
let pinned = false;
let busy = false;
let prepBusy = false;
let coBusy = false;
let zoomManual = false;
let zoomVal = null;
let resumes = [];
let activeResumeId = null;

// ============================================================
// 主题
// ============================================================
function applyTheme() {
  const dark = !!settings.darkTheme;
  document.body.dataset.theme = dark ? "dark" : "light";
  if ($("#darkTheme")) $("#darkTheme").checked = dark;
}

// ============================================================
// 状态提示
// ============================================================
function setStatus(text, isErr, el = $("#status")) {
  if (!el) return;
  el.textContent = text || "";
  el.className = "status" + (isErr ? " err" : "") + (text && !isErr ? " busy" : "");
}
function toast(msg) {
  const el = $("#saveStatus");
  if (!el) return;
  el.textContent = msg;
  el.className = "status";
  setTimeout(() => { el.textContent = ""; }, 2500);
}

// ============================================================
// 设置
// ============================================================
// ---------- 多简历 ----------
function normalizeResumes(s) {
  const list = Array.isArray(s.resumes) ? s.resumes.filter((r) => r && r.id) : [];
  let active = s.activeResumeId && list.some((r) => r.id === s.activeResumeId) ? s.activeResumeId : (list[0] && list[0].id) || null;
  if (!list.length) {
    const legacy = String(s.resumeText || "").trim();
    if (legacy) {
      list.push({ id: "default", name: s.resumeFileName || "简历 1", text: s.resumeText, fileName: s.resumeFileName || "" });
      active = "default";
    }
  }
  return { list, active };
}

function currentResume() {
  return resumes.find((r) => r.id === activeResumeId) || resumes[0] || null;
}

function syncResumeTextFromEditor() {
  const c = currentResume();
  if (c) {
    c.text = $("#resumeText").value;
    c.name = $("#resumeName").value.trim() || c.name;
  }
}

function renderResumeList() {
  const sel = $("#resumeList");
  sel.innerHTML = "";
  resumes.forEach((r, i) => {
    const opt = document.createElement("option");
    opt.value = r.id;
    opt.textContent = r.name || "简历 " + (i + 1);
    sel.appendChild(opt);
  });
  if (resumes.length) sel.value = activeResumeId;
  $("#btnResumeDel").disabled = resumes.length <= 1;
  const cur = currentResume();
  $("#resumeName").value = cur ? (cur.name || "") : "";
  $("#resumeText").value = cur ? (cur.text || "") : "";
  refreshStatus();
}

function bindResumeEvents() {
  $("#resumeText").addEventListener("input", () => {
    const c = currentResume();
    if (c) c.text = $("#resumeText").value;
  });
  $("#resumeName").addEventListener("input", () => {
    const c = currentResume();
    if (c) c.name = $("#resumeName").value.trim();
  });
  $("#resumeList").addEventListener("change", () => {
    syncResumeTextFromEditor();
    activeResumeId = $("#resumeList").value;
    renderResumeList();
  });
  $("#btnResumeAdd").onclick = () => {
    syncResumeTextFromEditor();
    const n = { id: "r_" + Date.now().toString(36), name: "简历 " + (resumes.length + 1), text: "", fileName: "" };
    resumes.push(n);
    activeResumeId = n.id;
    renderResumeList();
    $("#resumeText").focus();
  };
  $("#btnResumeDel").onclick = () => {
    if (resumes.length <= 1) return;
    syncResumeTextFromEditor();
    resumes = resumes.filter((r) => r.id !== activeResumeId);
    activeResumeId = (resumes[0] && resumes[0].id) || null;
    renderResumeList();
  };
}

async function loadSettings() {
  const d = await api.getStore("bossAiSettings");
  settings = d.bossAiSettings || {};
  const norm = normalizeResumes(settings);
  resumes = norm.list;
  activeResumeId = norm.active;
  $("#apiKey").value = settings.apiKey || "";
  $("#model").value = settings.model || "deepseek-chat";
  $("#style").value = settings.style || "prof";
  $("#customPrompt").value = settings.customPrompt || "";
  renderResumeList();
  $("#autoReply").checked = settings.autoReply !== false;
  $("#notifySound").checked = settings.notifySound === true;
  $("#cooldown").value = settings.cooldown || 10;
  $("#maxContext").value = settings.maxContext || 8;
  applyTheme();
  refreshStatus();
}

async function saveSettings() {
  syncResumeTextFromEditor();
  const cur = currentResume();
  const obj = {
    apiKey: $("#apiKey").value.trim(),
    model: $("#model").value,
    style: $("#style").value,
    customPrompt: $("#customPrompt").value.trim(),
    resumes,
    activeResumeId,
    resumeText: cur ? cur.text : "",
    resumeFileName: cur ? cur.fileName : "",
    autoReply: $("#autoReply").checked,
    notifySound: !!$("#notifySound").checked,
    darkTheme: !!$("#darkTheme").checked,
    cooldown: parseInt($("#cooldown").value) || 10,
    maxContext: parseInt($("#maxContext").value) || 8
  };
  await api.setStore({ bossAiSettings: obj });
  settings = obj;
  applyTheme();
  toast("设置已保存");
  refreshStatus();
}

async function refreshStatus() {
  const d = await api.getStore("bossAiSettings");
  const s = d.bossAiSettings || {};
  const st = await api.bossAction({ type: "panel-status" });
  const info = st.ok ? st.status : {};
  const parts = [];
  const cur = currentResume();
  parts.push(cur && String(cur.text || "").trim() ? '<span class="st ok">简历</span>' : '<span class="st no">简历</span>');
  parts.push(s.apiKey ? '<span class="st ok">API</span>' : '<span class="st no">API</span>');
  parts.push(info.onDetail ? '<span class="st ok">JD</span>' : '<span class="st">JD</span>');
  parts.push(s.autoReply !== false ? '<span class="st ok">提醒</span>' : '<span class="st no">提醒</span>');
  $("#statusbar").innerHTML = parts.join("");
}

// ============================================================
// BOSS 缩放
// ============================================================
async function refreshZoom() {
  const r = await api.getBossZoom();
  if (!r.ok) return;
  zoomManual = !!r.manual;
  zoomVal = r.zoom;
  const lbl = $("#zoomLabel");
  lbl.textContent = zoomManual ? Math.round(zoomVal * 100) + "%" : "自动";
  lbl.classList.toggle("manual", zoomManual);
}
async function setZoom(level) {
  const r = await api.setBossZoom(level);
  if (r.ok) { zoomManual = !!r.manual; zoomVal = r.zoom; refreshZoom(); }
}

// ============================================================
// 智能体状态条 + 活动流
// ============================================================
function setAgentState(state, text) {
  const dot = $("#agentDot");
  const t = $("#agentText");
  dot.className = "agent-idle-dot" + (state ? " " + state : "");
  if (text) t.textContent = text;
}

async function renderActivity() {
  const r = await api.agentLog();
  const box = $("#activity");
  const entries = (r.ok ? r.log : []).filter((e) => e.type === "done" || e.type === "error" || e.type === "cancelled");
  if (!entries.length) {
    box.innerHTML = '<div class="act-empty">暂无智能体任务记录</div>';
    return;
  }
  box.innerHTML = "";
  for (const e of entries.slice(0, 12)) {
    const item = document.createElement("div");
    item.className = "act-item";
    const icon = AGENT_ICONS[e.agent] || "i-spark";
    const sub = e.type === "error" ? "执行失败：" + (e.error || "")
      : e.type === "cancelled" ? "已停止"
      : "耗时 " + (e.ms ? (e.ms / 1000).toFixed(1) + " 秒" : "-") + (e.chars ? " · " + e.chars + " 字符" : "");
    item.innerHTML = '<span class="act-icon ' + e.type + '"><svg class="ic"><use href="#' + icon + '"/></svg></span>' +
      '<span class="act-main"><span class="act-name">' + (e.agentName || e.agent) + '</span><div class="act-sub">' + esc(sub) + "</div></span>" +
      '<span class="act-time">' + fmtTime(e.ts) + "</span>";
    box.appendChild(item);
  }
}

function fmtTime(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, "0");
  return p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
}

function esc(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ============================================================
// 生成（招呼语 / 回复）—— 直接走多智能体编排（支持停止）
// ============================================================
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

async function saveHistory(entry) {
  const d = await api.getStore("bossAiHistory");
  const list = d.bossAiHistory || [];
  entry.ts = Date.now();
  list.unshift(entry);
  if (list.length > 50) list.length = 50;
  await api.setStore({ bossAiHistory: list });
}

async function runAction(kind) {
  if (busy) return;
  await loadSettings();
  if (!settings.apiKey) { setStatus("未配置 API Key，请在设置页填写", true); showTab("settings"); return; }
  const curResume = currentResume();
  if (kind === "greeting" && !(curResume && String(curResume.text || "").trim())) {
    setStatus("未配置简历，生成效果会变差（可在设置页粘贴简历）", true);
  }
  $("#content").innerHTML = "";
  busy = true;
  $("#btnGreeting").disabled = true;
  $("#btnReply").disabled = true;
  setStatus("正在生成…（模型思考约 10~40 秒）");
  setAgentState("busy", (kind === "greeting" ? "招呼语专家" : "回复助手") + " · 生成中…");
  try {
    if (kind === "greeting") {
      const jdR = await api.bossAction({ type: "getJd" });
      if (!jdR.ok || !jdR.jd || !jdR.jd.hasJd) throw new Error("未识别到职位信息，请先在左侧打开职位详情页");
      const res = await api.agentInvoke("greeting", { jd: jdR.jd });
      if (!res.ok) throw new Error(res.error || "生成失败");
      const versions = splitVersions(res.text);
      if (versions.length) {
        await saveHistory({ kind: "greeting", title: jdR.jd.title, company: jdR.jd.company, result: res.text });
        await api.setStore({
          bossAiPendingGreeting: {
            versions,
            job: { title: jdR.jd.title, company: jdR.jd.company, salary: jdR.jd.salary },
            ts: Date.now()
          }
        });
      }
      renderGreeting({ jd: jdR.jd, versions });
      renderPending();
    } else {
      const ctxR = await api.bossAction({ type: "get-chat-history" });
      if (!ctxR.ok || !ctxR.history) throw new Error("当前不在聊天页，请先在左侧打开聊天窗口");
      const last = (ctxR.history || []).filter((h) => !h.self).pop();
      if (!last) throw new Error("未检测到对方的消息");
      const res = await api.agentInvoke("reply", { jd: ctxR.jd || {}, history: ctxR.history || [] });
      if (!res.ok) throw new Error(res.error || "生成失败");
      await saveHistory({ kind: "reply", title: (ctxR.jd || {}).title, company: (ctxR.jd || {}).company, result: res.text });
      renderReply({ jd: ctxR.jd || {}, reply: res.text, lastMsg: last.text });
    }
    setStatus("");
  } catch (err) {
    const msg = String((err && err.message) || err);
    if (/已停止|已取消/.test(msg)) setStatus("已停止生成");
    else setStatus(msg, true);
  } finally {
    busy = false;
    $("#btnGreeting").disabled = false;
    $("#btnReply").disabled = false;
    setAgentState("", "多智能体系统就绪");
  }
}

function renderGreeting(res) {
  const c = $("#content");
  c.innerHTML = "";
  c.appendChild(jdBox(res.jd));
  (res.versions || []).forEach((v, i) => c.appendChild(versionCard("招呼语 " + (i + 1), v, "greeting")));
}

function renderReply(res) {
  const c = $("#content");
  c.innerHTML = "";
  const jd = document.createElement("div");
  jd.className = "jd-box";
  jd.innerHTML = "<b>对方：</b>" + esc((res.lastMsg || "").slice(0, 80)) + "<br><b>职位：</b>" + esc(res.jd.title || "未知");
  c.appendChild(jd);
  c.appendChild(versionCard("AI 回复", res.reply, "reply"));
}

function jdBox(jd) {
  const el = document.createElement("div");
  el.className = "jd-box";
  el.innerHTML = "<b>" + esc(jd.title || "职位") + "</b>" +
    (jd.salary ? " · " + esc(jd.salary) : "") +
    (jd.company ? " · " + esc(jd.company) : "") +
    "<br>" + esc(jd.desc ? jd.desc.slice(0, 120) : "未获取到职位描述");
  return el;
}

function versionCard(tag, text, kind) {
  const card = document.createElement("div");
  card.className = "ver";
  card.innerHTML = '<span class="tag">' + esc(tag) + '</span><div class="txt"></div><div class="ops"></div>';
  card.querySelector(".txt").textContent = text;
  const ops = card.querySelector(".ops");

  const fill = mkBtn("填入输入框", async () => {
    const r = await api.bossAction({ type: "fill-input", kind, text });
    if (r.ok) { fill.textContent = "已填入"; if (kind === "greeting") renderPending(); }
    else if (/未找到|输入框/.test(r.error || "")) {
      fill.textContent = "跳转中…";
      await api.bossAction({ type: "goto-chat-and-fill", text });
      setTimeout(() => { fill.textContent = "已跳转"; }, 1500);
    } else {
      fill.textContent = "失败";
      setStatus(r.error || "填入失败", true);
      setTimeout(() => { fill.textContent = "填入输入框"; }, 1500);
    }
  });
  const copy = mkBtn("复制", async () => {
    try { await navigator.clipboard.writeText(text); copy.textContent = "已复制"; setTimeout(() => (copy.textContent = "复制"), 1200); } catch (e) {}
  });
  const regen = mkBtn("换一条", () => runAction(kind));
  ops.appendChild(fill); ops.appendChild(copy); ops.appendChild(regen);
  return card;
}

function mkBtn(text, onclick) {
  const b = document.createElement("button");
  b.className = "btn secondary sm";
  b.textContent = text;
  b.onclick = onclick;
  return b;
}

// ============================================================
// 待发送招呼语
// ============================================================
async function renderPending() {
  const d = await api.getStore("bossAiPendingGreeting");
  const data = d.bossAiPendingGreeting;
  const box = $("#pendingBox");
  if (!data || !data.versions || !data.versions.length) { box.style.display = "none"; return; }
  const job = data.job || {};
  box.innerHTML = '<div class="pending-title">待发送 · ' + esc(job.title || "职位") +
    (job.salary ? " " + esc(job.salary) : "") + (job.company ? " · " + esc(job.company) : "") + "</div>";
  data.versions.forEach((v, i) => box.appendChild(versionCard("招呼语 " + (i + 1), v, "greeting")));
  const discard = document.createElement("button");
  discard.className = "btn ghost sm";
  discard.style.width = "100%";
  discard.style.marginTop = "6px";
  discard.textContent = "丢弃全部";
  discard.onclick = async () => { await api.setStore({ bossAiPendingGreeting: null }); box.style.display = "none"; };
  box.appendChild(discard);
  box.style.display = "block";
}

// ============================================================
// 对话助手（自由问答 + 问卷模式）
// ============================================================
const CHAT_KEY = "bossAiChatHistory";
const CHAT_CAP = 40;
let chatHistory = [];
let chatMode = "chat"; // chat | form
let chatBusy = false;

async function persistChat() {
  if (chatHistory.length > CHAT_CAP) chatHistory = chatHistory.slice(-CHAT_CAP);
  await api.setStore({ [CHAT_KEY]: chatHistory });
}

async function loadChat() {
  try {
    const d = await api.getStore(CHAT_KEY);
    chatHistory = Array.isArray(d && d[CHAT_KEY]) ? d[CHAT_KEY] : [];
  } catch (e) {
    chatHistory = [];
  }
  renderChat();
}

function renderChat() {
  const box = $("#chatMsgs");
  box.innerHTML = "";
  if (!chatHistory.length) {
    box.innerHTML = '<div class="chat-empty">开始对话吧<br>任何求职问题都可以问：薪资谈判、HR 应对、岗位理解、自我介绍…</div>';
    return;
  }
  chatHistory.forEach((m) => {
    box.appendChild(chatBubble(m.role === "assistant", String(m.content || "")));
  });
  box.scrollTop = box.scrollHeight;
}

function chatBubble(isBot, content) {
  const item = document.createElement("div");
  item.className = "msg " + (isBot ? "bot" : "user");
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  if (isBot) {
    bubble.innerHTML = renderMd(content);
    const ops = document.createElement("div");
    ops.className = "bubble-ops";
    const copy = mkBtn("复制", async () => {
      try {
        await navigator.clipboard.writeText(content);
        copy.textContent = "已复制";
        setTimeout(() => (copy.textContent = "复制"), 1200);
      } catch (e) {}
    });
    ops.appendChild(copy);
    bubble.appendChild(ops);
  } else {
    bubble.textContent = content;
  }
  item.appendChild(bubble);
  return item;
}

function renderChatMode() {
  document.querySelectorAll(".mode-btn").forEach((b) => b.classList.toggle("on", b.dataset.mode === chatMode));
  const hint = $("#chatHint");
  if (chatMode === "form") {
    bindChatFromChat('<span class="mode-tag">问卷模式</span>把 HR 发的问卷/问题粘贴到输入框，助手会结合简历逐题给出建议答案。');
  } else {
    hint.innerHTML = "问任何求职问题：薪资谈判、HR 应对、岗位理解、自我介绍… 回答会参考你的简历。";
  }
}

function bindChatFromChat(baseHtml) {
  const hint = $("#chatHint");
  hint.innerHTML = baseHtml + '<button class="link-btn" id="chatFromChat">从会话获取</button>';
  $("#chatFromChat").onclick = async () => {
    try {
      const r = await api.bossAction({ type: "get-chat-history" });
      if (!r.ok || !r.history || !r.history.length) {
        bindChatFromChat('<span class="mode-tag">问卷模式</span>当前不在聊天页或没有对方消息，请手动粘贴问卷。');
        return;
      }
      const other = r.history.filter((h) => !h.self).map((h) => h.text || "").join("\n").slice(0, 4000);
      const el = $("#chatInput");
      el.value = el.value.trim() ? el.value.trim() + "\n\n" + other : other;
      el.focus();
      bindChatFromChat('<span class="mode-tag">问卷模式</span>已从会话粘贴对方消息，检查后发送即可。');
    } catch (e) {}
  };
}

async function sendChat() {
  const input = $("#chatInput").value.trim();
  if (!input || chatBusy) return;
  chatHistory.push({ role: "user", content: input });
  $("#chatInput").value = "";
  await persistChat();
  renderChat();
  chatBusy = true;
  $("#chatSend").disabled = true;
  setAgentState("busy", "对话助手 · 思考中…");
  const typing = document.createElement("div");
  typing.className = "msg bot";
  typing.innerHTML = '<div class="bubble typing">正在思考…</div>';
  const box = $("#chatMsgs");
  box.appendChild(typing);
  box.scrollTop = box.scrollHeight;
  let jd = null;
  try {
    const jr = await api.bossAction({ type: "get-chat-history" });
    if (jr && jr.ok && jr.jd && (jr.jd.title || jr.jd.desc)) jd = jr.jd;
  } catch (e) {}
  try {
    const r = await api.agentInvoke("chat", { messages: chatHistory, mode: chatMode, jd });
    typing.remove();
    if (!r.ok) {
      const msg = String(r.error || "生成失败");
      chatHistory.pop();
      await persistChat();
      if (/已停止|已取消/.test(msg)) {
        setAgentState("", "任务已停止");
        return;
      }
      setAgentState("err", "对话助手执行失败");
      box.appendChild(chatBubble(true, msg));
      box.scrollTop = box.scrollHeight;
      return;
    }
    chatHistory.push({ role: "assistant", content: r.text });
    await persistChat();
    setAgentState("", "多智能体系统就绪");
    renderChat();
    if (jd && jd.title) setStatus("已结合岗位「" + jd.title + "」作答");
  } catch (e) {
    typing.remove();
    chatHistory.pop();
    await persistChat();
    box.appendChild(chatBubble(true, String((e && e.message) || e)));
    box.scrollTop = box.scrollHeight;
    setAgentState("err", "对话助手执行失败");
  } finally {
    chatBusy = false;
    $("#chatSend").disabled = false;
  }
}

// ============================================================
// 求职信 Agent
// ============================================================
function showLetterForm() {
  const c = $("#content");
  c.innerHTML = "";
  const form = document.createElement("div");
  form.className = "card";
  form.innerHTML =
    '<div class="card-head"><h2>求职信</h2><span class="badge badge-agent">Agent · 求职信助手</span></div>' +
    '<div class="field-row">' +
    '<div class="field"><label>公司</label><input type="text" id="ltCompany" placeholder="公司名称"></div>' +
    '<div class="field"><label>岗位</label><input type="text" id="ltTitle" placeholder="岗位名称"></div>' +
    '</div>' +
    '<div class="field"><label>职位描述（选填）</label><textarea id="ltJd" rows="3" placeholder="粘贴 JD 或从会话获取"></textarea></div>' +
    '<div class="btn-row">' +
    '<button class="btn secondary" id="ltFromChat">从会话获取</button>' +
    '<button class="btn primary flex" id="ltGenerate">生成求职信</button>' +
    '</div><div class="status" id="ltStatus"></div>';
  c.appendChild(form);
  $("#ltGenerate").onclick = async () => {
    const company = $("#ltCompany").value.trim();
    const title = $("#ltTitle").value.trim();
    if (!company && !title) { $("#ltStatus").textContent = "请填写公司或岗位"; $("#ltStatus").className = "status err"; return; }
    if (busy) return;
    busy = true;
    $("#ltGenerate").disabled = true;
    $("#ltStatus").innerHTML = '<span class="status busy">求职信智能体运行中…（约 15~40 秒）</span>';
    setAgentState("busy", "求职信助手 · 撰写中…");
    const r = await api.agentInvoke("application", {
      company, title,
      jdDesc: $("#ltJd").value.trim(),
      resumeText: (currentResume() || {}).text || ""
    });
    busy = false;
    $("#ltGenerate").disabled = false;
    if (!r.ok) {
      const msg = String(r.error || "生成失败");
      const stopped = /已停止|已取消/.test(msg);
      $("#ltStatus").textContent = stopped ? "已停止" : msg;
      $("#ltStatus").className = "status" + (stopped ? "" : " err");
      setAgentState("", stopped ? "任务已停止" : "多智能体系统就绪");
      return;
    }
    $("#ltStatus").textContent = "";
    setAgentState("", "多智能体系统就绪");
    const res = document.createElement("div");
    res.className = "ver";
    res.innerHTML = '<span class="tag">求职信</span><div class="txt"></div><div class="ops"><button class="btn secondary sm" id="ltCopy">复制全文</button></div>';
    res.querySelector(".txt").textContent = r.text;
    $("#ltCopy").onclick = async () => {
      try { await navigator.clipboard.writeText(r.text); $("#ltCopy").textContent = "已复制"; } catch (e) {}
    };
    c.appendChild(res);
  };
  $("#ltFromChat").onclick = async () => {
    const r = await api.bossAction({ type: "get-chat-context" });
    if (!r.ok || !r.ctx) { $("#ltStatus").textContent = "当前不在聊天页，请手动填写"; $("#ltStatus").className = "status err"; return; }
    if (r.ctx.company) $("#ltCompany").value = r.ctx.company;
    if (r.ctx.title) $("#ltTitle").value = r.ctx.title;
    if (r.ctx.jdDesc) $("#ltJd").value = r.ctx.jdDesc;
    $("#ltStatus").textContent = "已获取会话上下文";
  };
}

// ============================================================
// 面试准备（Agent 编排）
// ============================================================
function setPrepStatus(text, isErr) {
  const el = $("#prepStatus");
  el.textContent = text || "";
  el.className = "status" + (isErr ? " err" : "") + (text && !isErr ? " busy" : "");
}

async function doPrep() {
  if (prepBusy) return;
  const company = $("#ivCompany").value.trim();
  const title = $("#ivTitle").value.trim();
  if (!company && !title) { setPrepStatus("请填写公司或岗位", true); return; }
  prepBusy = true;
  $("#btnPrep").disabled = true;
  $("#prepResult").innerHTML = "";
  setPrepStatus("面试教练智能体：正在检索公司情报并生成准备卡…");
  setAgentState("busy", "面试教练 · 研究中…");
  const r = await api.agentInvoke("interview", {
    company, title,
    jdDesc: $("#ivJd").value.trim(),
    resumeText: (currentResume() || {}).text || ""
  });
  prepBusy = false;
  $("#btnPrep").disabled = false;
  if (!r.ok) {
    const msg = String(r.error || "生成失败");
    const stopped = /已停止|已取消/.test(msg);
    setPrepStatus(stopped ? "已停止" : msg, !stopped);
    setAgentState("", stopped ? "任务已停止" : "多智能体系统就绪");
    return;
  }
  setPrepStatus("");
  setAgentState("", "多智能体系统就绪");
  $("#prepResult").innerHTML = '<div class="ver"><div class="txt">' + renderMd(r.text) + "</div><div class='ops'><button class='btn secondary sm' id='prepCopy'>复制</button></div></div>";
  $("#prepCopy").onclick = async () => {
    try { await navigator.clipboard.writeText(r.text); $("#prepCopy").textContent = "已复制"; } catch (e) {}
  };
}

function renderMd(text) {
  const fmt = (raw) => {
    let s = esc(raw);
    s = s.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
    s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
    return s;
  };
  const lines = (text || "").split("\n");
  let html = "";
  let i = 0;
  const isTableSep = (l) => /^\s*\|?[\s:|-]+\|?\s*$/.test(l) && l.includes("-") && l.includes("|");
  while (i < lines.length) {
    const raw = lines[i];
    const line = raw.trim();
    if (!line) { html += '<div class="md-space"></div>'; i++; continue; }
    if (line.startsWith("|") && lines[i + 1] && isTableSep(lines[i + 1])) {
      const head = line.replace(/^\||\|$/g, "").split("|").map((c) => fmt(c.trim()));
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        rows.push(lines[i].replace(/^\||\|$/g, "").split("|").map((c) => fmt(c.trim())));
        i++;
      }
      html += '<div class="md-table"><div class="md-tr md-th">' + head.map((c) => '<div class="md-td">' + c + "</div>").join("") + "</div>" +
        rows.map((r) => '<div class="md-tr">' + r.map((c) => '<div class="md-td">' + c + "</div>").join("") + "</div>").join("") + "</div>";
      continue;
    }
    if (/^#{1,3}\s+/.test(line)) {
      const level = Math.min(3, line.match(/^#+/)[0].length);
      html += '<div class="' + (level >= 3 ? "md-h2" : "md-h1") + '">' + fmt(line.replace(/^#+\s+/, "")) + "</div>";
      i++; continue;
    }
    if (/^\s*[-*_]{3,}\s*$/.test(line)) { html += '<hr class="md-hr">'; i++; continue; }
    if (/^>\s?/.test(line)) {
      const quote = [];
      while (i < lines.length && /^>\s?/.test(lines[i].trim())) { quote.push(fmt(lines[i].trim().replace(/^>\s?/, ""))); i++; }
      html += '<div class="md-quote">' + quote.join("<br>") + "</div>";
      continue;
    }
    if (/^[-*•]\s+/.test(line)) { html += '<div class="md-li">· ' + fmt(line.replace(/^[-*•]\s+/, "")) + "</div>"; i++; continue; }
    if (/^\d+[.、]\s*/.test(line)) { html += '<div class="md-num">' + fmt(line) + "</div>"; i++; continue; }
    html += '<div class="md-p">' + fmt(line) + "</div>";
    i++;
  }
  return html;
}

// 面试记录
const IV_KEY = "bossAiInterviews";
async function loadInterviews() {
  const d = await api.getStore(IV_KEY);
  return (d && d[IV_KEY]) || [];
}

async function renderInterviewList() {
  const list = await loadInterviews();
  const box = $("#ivList");
  if (!list.length) { box.innerHTML = '<div class="iv-empty">还没有面试记录，添加第一条吧</div>'; return; }
  list.sort((a, b) => (b.ts || 0) - (a.ts || 0));
  const tagMap = { pending: "待确认", confirmed: "已约面", done: "已完成", cancelled: "已取消" };
  box.innerHTML = "";
  for (const it of list) {
    const item = document.createElement("div");
    item.className = "iv-item";
    item.innerHTML = '<div class="iv-top"><span class="iv-co"></span><span class="iv-tag ' + esc(it.status || "pending") + '"></span></div>' +
      '<div class="iv-sub"></div><div class="iv-ops"></div>';
    item.querySelector(".iv-co").textContent = (it.company || "") + " · " + (it.title || "");
    item.querySelector(".iv-tag").textContent = tagMap[it.status] || it.status;
    const sub = [];
    if (it.date) sub.push(it.date);
    if (it.note) sub.push(it.note);
    item.querySelector(".iv-sub").textContent = sub.join("  ·  ");
    const ops = item.querySelector(".iv-ops");
    const prep = mkBtn("生成准备卡", () => {
      $("#ivCompany").value = it.company || "";
      $("#ivTitle").value = it.title || "";
      showTab("interview");
      doPrep();
    });
    const del = mkBtn("删除", async () => {
      const nl = (await loadInterviews()).filter((x) => x.id !== it.id);
      await api.setStore({ [IV_KEY]: nl });
      renderInterviewList();
    });
    ops.appendChild(prep); ops.appendChild(del);
    box.appendChild(item);
  }
}

// 面试问题库
const Q_KEY = "bossAiInterviewQuestions";
async function loadQuestions() {
  const d = await api.getStore(Q_KEY);
  return (d && d[Q_KEY]) || [];
}

async function renderQuestionList() {
  const list = await loadQuestions();
  const box = $("#ivqList");
  if (!list.length) { box.innerHTML = '<div class="iv-empty">还没有记录问题，把面试中被问到的问题存进来吧</div>'; return; }
  list.sort((a, b) => (b.ts || 0) - (a.ts || 0));
  box.innerHTML = "";
  for (const it of list) {
    const item = document.createElement("div");
    item.className = "iv-item ivq-item";
    item.innerHTML = '<div class="iv-top"><span class="iv-co ivq-q"></span><span class="ivq-src"></span></div>' +
      '<div class="ivq-ans" style="display:none;"></div><div class="iv-ops"></div>';
    item.querySelector(".ivq-q").textContent = it.question || "";
    const src = [];
    if (it.company) src.push(it.company);
    if (it.title) src.push(it.title);
    item.querySelector(".ivq-src").textContent = src.join(" · ");
    const ops = item.querySelector(".iv-ops");
    if (it.answer) {
      const ans = item.querySelector(".ivq-ans");
      ans.textContent = "我的回答：" + it.answer;
      const toggle = mkBtn("查看回答", () => {
        const show = ans.style.display === "none";
        ans.style.display = show ? "block" : "none";
        toggle.textContent = show ? "收起回答" : "查看回答";
      });
      ops.appendChild(toggle);
    }
    const del = mkBtn("删除", async () => {
      const nl = (await loadQuestions()).filter((x) => x.id !== it.id);
      await api.setStore({ [Q_KEY]: nl });
      renderQuestionList();
    });
    ops.appendChild(del);
    box.appendChild(item);
  }
}

// ============================================================
// 公司尽调（Agent 编排 + 进度）
// ============================================================
function setCoStatus(text, isErr) {
  const el = $("#coStatus");
  el.textContent = text || "";
  el.className = "status" + (isErr ? " err" : "") + (text && !isErr ? " busy" : "");
}

function setCoProgress(visible, pct, label) {
  $("#coProgress").style.display = visible ? "block" : "none";
  if (visible) {
    $("#coProgressBar").style.width = Math.round(pct * 100) + "%";
    $("#coProgressLabel").textContent = label || "";
  }
}

async function doCompanyAnalyze() {
  if (coBusy) return;
  const company = $("#coName").value.trim();
  if (!company) { setCoStatus("请输入公司名称", true); return; }
  coBusy = true;
  $("#btnCompany").disabled = true;
  setCoStatus("尽调分析师：正在多源检索公开信息…");
  setAgentState("busy", "尽调分析师 · 检索与写作中…");
  setCoProgress(true, 0.05, "开始检索");
  $("#coResult").innerHTML = "";
  const input = { company };
  if (xhsEvidence && xhsEvidence.length) input.xhsNotes = xhsEvidence;
  const r = await api.agentInvoke("company", input);
  coBusy = false;
  $("#btnCompany").disabled = false;
  setCoProgress(false);
  if (!r.ok) {
    const msg = String(r.error || "分析失败");
    setCoStatus(/已停止|已取消/.test(msg) ? "已停止" : msg, !/已停止|已取消/.test(msg));
    setAgentState("", "多智能体系统就绪");
    return;
  }
  setCoStatus("");
  setAgentState("", "多智能体系统就绪");
  const el = document.createElement("div");
  el.className = "ver";
  const ops = document.createElement("div");
  ops.className = "ops";
  const copy = mkBtn("复制报告", async () => {
    try { await navigator.clipboard.writeText(r.text); copy.textContent = "已复制"; setTimeout(() => (copy.textContent = "复制报告"), 1200); } catch (e) {}
  });
  const exportBtn = mkBtn("导出 Markdown", async () => {
    exportBtn.textContent = "导出中…";
    const sr = await api.saveReport(company + "-尽调报告-" + new Date().toISOString().slice(0, 10), r.text);
    if (sr.ok) { exportBtn.textContent = "已导出✓"; setTimeout(() => (exportBtn.textContent = "导出 Markdown"), 1500); }
    else if (sr.cancelled) { exportBtn.textContent = "导出 Markdown"; }
    else { exportBtn.textContent = "导出失败"; setCoStatus(sr.error || "导出失败", true); setTimeout(() => (exportBtn.textContent = "导出 Markdown"), 1500); }
  });
  ops.appendChild(copy); ops.appendChild(exportBtn);
  el.innerHTML = '<span class="tag">尽调报告</span><div class="txt"></div>';
  el.appendChild(ops);
  el.querySelector(".txt").innerHTML = renderMd(r.text);
  $("#coResult").appendChild(el);
}

// ============================================================
// 批量公司解析 + 批量尽调
// ============================================================
let batchBusy = false;
let batchCompanies = [];

function setBatchStatus(text, isErr) {
  const el = $("#batchStatus");
  el.textContent = text || "";
  el.className = "status" + (isErr ? " err" : "") + (text && !isErr ? " busy" : "");
}

// 本地规则兜底提取（LLM 解析失败时使用）：公司名后缀匹配 + 泛指词过滤
function extractCompanyCandidates(text) {
  const RE = /[\u4e00-\u9fa5A-Za-z0-9（）()]{2,}(?:股份有限公司|有限责任公司|集团有限公司|有限公司|集团|公司)/g;
  const out = [];
  const seen = new Set();
  for (const m of String(text || "").matchAll(RE)) {
    const s = m[0].trim();
    if (s.length < 4) continue;
    if (/上市公司|公司业务|公司简介|旗下公司|子公司|总公司|分公司|创业公司|母公司|大厂|甲方|乙方|公司内部|公司团队|公司招聘|公司官网|公司主页|公司介绍|公司信息|公司地址|公司电话|公司名称|公司情况/.test(s)) continue;
    if (!seen.has(s)) { seen.add(s); out.push(s); }
    if (out.length >= 30) break;
  }
  return out;
}

function parseJsonArr(t) {
  const s = String(t || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const m = s.match(/\[[\s\S]*\]/);
  if (!m) return null;
  try {
    const v = JSON.parse(m[0]);
    return Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : null;
  } catch (e) { return null; }
}

async function doParseCompanies() {
  if (batchBusy) return;
  const text = $("#batchText").value.trim();
  if (!text) { setBatchStatus("请先粘贴文本", true); return; }
  batchBusy = true;
  setBatchStatus("公司名解析器：正在提取公司名…");
  const cands = extractCompanyCandidates(text);
  let refined = null;
  let usedLlm = false;
  try {
    const r = await api.agentInvoke("company-parse", { text, candidates: cands });
    if (r.ok) { refined = parseJsonArr(r.text); usedLlm = !!refined; }
  } catch (e) {}
  batchCompanies = (usedLlm ? refined : cands).slice(0, 30);
  batchBusy = false;
  if (!batchCompanies.length) { setBatchStatus("未识别到公司名，请确认文本包含完整公司名", true); $("#batchResult").innerHTML = ""; $("#btnBatchRun").style.display = "none"; return; }
  setBatchStatus("解析完成，共 " + batchCompanies.length + " 家" + (usedLlm ? "（AI 已去重纠错）" : "（本地规则识别）"));
  renderBatchCandidates();
}

function renderBatchCandidates() {
  const box = $("#batchCandidates");
  box.innerHTML = "";
  $("#btnBatchRun").style.display = batchCompanies.length ? "block" : "none";
  batchCompanies.forEach((c, i) => {
    const row = document.createElement("label");
    row.className = "batch-cand";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = true;
    cb.className = "batch-cb";
    const span = document.createElement("span");
    span.className = "batch-cand-name";
    span.textContent = (i + 1) + ". " + c;
    const del = document.createElement("button");
    del.type = "button";
    del.className = "btn ghost sm batch-del";
    del.textContent = "删除";
    del.onclick = (e) => { e.preventDefault(); batchCompanies.splice(i, 1); renderBatchCandidates(); };
    row.appendChild(cb); row.appendChild(span); row.appendChild(del);
    box.appendChild(row);
  });
}

function batchResultCard(name, r) {
  const item = document.createElement("div");
  item.className = "batch-item";
  const head = document.createElement("div");
  head.className = "batch-head";
  const nm = document.createElement("span");
  nm.className = "batch-name";
  nm.textContent = name;
  const tag = document.createElement("span");
  tag.className = "batch-tag " + (r.ok ? "ok" : "err");
  tag.textContent = r.ok ? "✓ 完成" : "失败";
  const chev = document.createElement("span");
  chev.className = "batch-chev";
  chev.textContent = "▾";
  head.appendChild(nm); head.appendChild(tag); head.appendChild(chev);
  const body = document.createElement("div");
  body.className = "batch-body";
  body.style.display = "none";
  if (r.ok) {
    const txt = document.createElement("div");
    txt.className = "txt";
    txt.innerHTML = renderMd(r.text);
    const ops = document.createElement("div");
    ops.className = "ops";
    const copy = mkBtn("复制报告", async () => {
      try { await navigator.clipboard.writeText(r.text); copy.textContent = "已复制"; setTimeout(() => (copy.textContent = "复制报告"), 1200); } catch (e) {}
    });
    const search = mkBtn("BOSS 搜岗位", () => {
      api.gotoUrl("https://www.zhipin.com/web/geek/jobs?query=" + encodeURIComponent(name));
    });
    ops.appendChild(copy); ops.appendChild(search);
    body.appendChild(txt); body.appendChild(ops);
  } else {
    const err = document.createElement("div");
    err.className = "batch-err";
    err.textContent = String(r.error || "分析失败");
    body.appendChild(err);
  }
  item.appendChild(head); item.appendChild(body);
  head.onclick = () => {
    const show = body.style.display === "none";
    body.style.display = show ? "block" : "none";
    chev.textContent = show ? "▴" : "▾";
  };
  head.style.cursor = "pointer";
  return item;
}

async function runBatch() {
  if (batchBusy) return;
  const rows = $("#batchCandidates").querySelectorAll(".batch-cand");
  const names = batchCompanies.filter((c, i) => rows[i] ? rows[i].querySelector("input").checked : true);
  if (!names.length) { setBatchStatus("请至少勾选一家公司", true); return; }
  batchBusy = true;
  $("#btnBatchRun").disabled = true;
  $("#btnParse").disabled = true;
  $("#btnCompany").disabled = true;
  $("#btnRisk").disabled = true;
  const box = $("#batchResult");
  box.innerHTML = "";
  let okCount = 0;
  for (let i = 0; i < names.length; i++) {
    const n = names[i];
    setBatchStatus("批量尽调 " + (i + 1) + "/" + names.length + " · " + n + " …");
    setAgentState("busy", "尽调分析师 · " + n + "（" + (i + 1) + "/" + names.length + "）");
    const r = await api.agentInvoke("company", { company: n });
    const card = batchResultCard(n, r);
    box.appendChild(card);
    card.scrollIntoView({ block: "nearest" });
    if (r.ok) okCount++;
  }
  batchBusy = false;
  $("#btnBatchRun").disabled = false;
  $("#btnParse").disabled = false;
  $("#btnCompany").disabled = false;
  $("#btnRisk").disabled = false;
  setAgentState("", "多智能体系统就绪");
  setBatchStatus(okCount === names.length ? "完成 " + names.length + " 家公司" : "完成 " + okCount + "/" + names.length + "（失败项可点击单独重试）");
}

// ============================================================
// 简历图片库
// ============================================================
async function renderPanelImages() {
  const box = $("#imgList");
  let r = null;
  try { r = await api.getImages(); } catch (e) {}
  const images = (r && r.images) || [];
  if (!images.length) { box.innerHTML = '<div class="iv-empty">还没有图片，点「＋ 上传」添加简历图</div>'; return; }
  box.innerHTML = "";
  for (const it of images) {
    const item = document.createElement("div");
    item.className = "img-row";
    const img = document.createElement("img");
    const info = document.createElement("div");
    info.className = "img-info";
    info.textContent = (it.name || "简历图") + "（" + Math.round((it.size || 0) / 1024) + " KB）";
    const send = mkBtn("发给对方", async () => {
      send.textContent = "发送中…";
      const sr = await api.bossAction({ type: "send-resume-image", id: it.id });
      send.textContent = "发给对方";
      if (sr && sr.ok) {
        setStatus("已注入聊天框上传入口，请确认后发送");
        toast("已填入聊天框");
      } else {
        setStatus((sr && sr.error) || "发送失败，请打开聊天窗口后重试", true);
      }
    });
    const del = mkBtn("删除", async () => {
      await api.delImage(it.id);
      renderPanelImages();
    });
    item.appendChild(img);
    item.appendChild(info);
    item.appendChild(send);
    item.appendChild(del);
    box.appendChild(item);
    const rd = await api.readImage(it.id);
    if (rd && rd.ok) img.src = rd.dataUrl;
  }
}

// ============================================================
// 求职避雷：本地静态检查单（零延迟，基于 BOSS 页当前职位/聊天上下文）
function riskScanLocal(jd, chatText) {
  const d = (jd && jd.desc) || "";
  const t = (jd && jd.tags) || "";
  const s = (jd && jd.salary) || "";
  const c = (jd && jd.company) || "";
  const chat = (chatText || "").slice(-800);
  const all = d + " " + t + " " + chat;
  const hits = [];
  const hit = (level, label, tip) => hits.push({ level, label, tip });
  if (/培训费|押金|保证金|先交|交费|收费|费用自理|培训贷|分期付款/.test(all))
    hit(3, "涉及交费/押金/培训贷", "正规企业不会向求职者收费——聊到钱直接放弃并到平台举报。");
  if (/身份证/.test(all) && /复印件|拍照|抵押|押/.test(all))
    hit(3, "要求身份证复印件/抵押", "入职前只需出示原件核验，要求留存复印件或扣押证件的都有风险。");
  if (/经验不限|无经验|应届生|接受小白/.test(all) && /1[3-9]K|2\dK|3\dK/.test(s) && d.length < 150)
    hit(2, "低门槛 + 高薪（" + s + "）", "高薪无门槛最可疑，面试必问薪资结构：底薪多少、绩效占比、有无隐形扣款。");
  if (!(jd && jd.hasJd) ? false : (!d && !t)) hit(1, "岗位描述极简/缺失", "JD 没有实质内容，可能是批量挂岗或信息收集，先查清楚再投。");
  else if (jd && jd.hasJd && d.length < 30) hit(1, "岗位描述极简（不足 30 字）", "描述过于简略，警惕批量挂岗。");
  if (/成为.{0,6}(自己|骄傲)|改变命运|人生赢家|共创辉煌|实现梦想/.test(all))
    hit(1, "励志口号式文案", "画饼文案常见于销售/培训类岗位，确认清楚再投。");
  if (/面议|薪资面议|上不封顶|综合薪资/.test(all))
    hit(1, "薪资含糊", "面试必问：底薪、绩效结构、社保基数、转正规则。");
  if (/劳务|人力|派遣|外包/.test(c))
    hit(2, "劳务派遣/外包特征", "确认用工主体是谁（签合同的公司），务必问清五险一金与转正机制。");
  if (/旗下|隶属|子公司|集团|上市|分支|分部/.test(d + c))
    hit(1, "攀附大厂表述", "确认与所称大厂的真实关系，别把关联公司当大厂直招。");
  if (/什么都能|全能|多面手|啥都做/.test(all) || (d.match(/负责/g) || []).length >= 3)
    hit(1, "职责空洞（什么都能干）", "职责不清的岗位，入职后往往身兼多职。");
  if (/急招|长期招|大量招|随时入职/.test(all))
    hit(1, "急招/长期挂岗话术", "常年挂在平台的岗位，小心是信息收集或 KPI 牛。");
  if (/培训$|先培训|收徒|学费|贷款|办卡/.test(chat))
    hit(3, "聊天出现培训/贷款字样", "凡是要你先培训交钱、贷款分期、办卡的，一律拉黑并举报。");
  return {
    score: hits.reduce((n, h) => n + h.level, 0),
    hits,
    tag: hits.length ? (hits.some((h) => h.level >= 2) ? "存在可疑信号" : "仅轻微信号") : "未见明显静态信号"
  };
}

// 避雷速查（RiskAgent：司法/口碑快速检索，应届生防骗）
async function doRiskCheck() {
  if (coBusy) return;
  const company = $("#coName").value.trim();
  if (!company) { setCoStatus("请输入公司名称或点「从当前职位获取」", true); return; }
  coBusy = true;
  $("#btnRisk").disabled = true;
  setCoStatus("避雷速查师：正在检索司法与招聘口碑…");
  setAgentState("busy", "避雷速查师 · 检索与写作中…");
  setCoProgress(true, 0.1, "本地检查单 + 深度检索");
  $("#coResult").innerHTML = "";

  // 1) 取 BOSS 页当前职位/聊天上下文，跑本地静态检查单（即时）
  let jd = null, chatText = "";
  try {
    const jr = await api.bossAction({ type: "get-chat-history" });
    if (jr && jr.ok) {
      jd = jr.jd || null;
      chatText = (jr.history || []).map((m) => (m.self ? "我：" : "对方：") + (m.text || "")).join("\n").slice(-1500);
    }
  } catch (e) {}
  const local = riskScanLocal(jd, chatText);
  const box = document.createElement("div");
  box.style.cssText = "font-size:12px;line-height:1.7;background:#f7f9fc;border:1px solid #eef1f6;border-radius:8px;padding:8px;margin-bottom:10px;color:#445;";
  if (!local.hits.length) {
    box.textContent = "本地检查单：" + local.tag + "（不代表无风险，继续深度检索…）";
  } else {
    const t = document.createElement("div");
    t.style.cssText = "font-weight:700;color:" + (local.score >= 4 ? "#d63031" : local.score >= 2 ? "#e1700a" : "#00a854") + ";margin-bottom:4px;";
    t.textContent = "本地检查单命中 " + local.hits.length + " 项（风险分 " + local.score + "）：";
    box.appendChild(t);
    local.hits.forEach((h) => {
      const row = document.createElement("div");
      row.style.cssText = "color:" + (h.level >= 2 ? "#d63031" : "#e1700a") + ";";
      row.textContent = "· " + h.label + "——" + h.tip;
      box.appendChild(row);
    });
  }
  $("#coResult").appendChild(box);

  // 2) 深度检索（公司名 + 职位/聊天上下文）
  setCoStatus("避雷速查师：正在检索司法与招聘口碑…");
  const r = await api.agentInvoke("risk", { company, jd, chatText });
  coBusy = false;
  $("#btnRisk").disabled = false;
  setCoProgress(false);
  if (!r.ok) {
    const msg = String(r.error || "速查失败");
    setCoStatus(/已停止|已取消/.test(msg) ? "已停止" : msg, !/已停止|已取消/.test(msg));
    setAgentState("", "多智能体系统就绪");
    return;
  }
  setCoStatus("");
  setAgentState("", "多智能体系统就绪");
  const el = document.createElement("div");
  el.className = "ver";
  const ops = document.createElement("div");
  ops.className = "ops";
  const copy = mkBtn("复制结果", async () => {
    try { await navigator.clipboard.writeText(r.text); copy.textContent = "已复制"; setTimeout(() => (copy.textContent = "复制结果"), 1200); } catch (e) {}
  });
  ops.appendChild(copy);
  el.innerHTML = '<span class="tag">避雷速查</span><div class="txt"></div>';
  el.appendChild(ops);
  el.querySelector(".txt").innerHTML = renderMd(r.text);
  $("#coResult").appendChild(el);
}

// ============================================================
// 小红书 AI 搜索 · 舆情证据采集（持久化到本地存储，刷新不丢）
// ============================================================
const XHS_KEY = "bossAiXhsEvidence";
let xhsEvidence = [];

function setXhsStatus(text, isErr) {
  const el = $("#xhsStatus");
  el.textContent = text || "";
  el.className = "status" + (isErr ? " err" : "") + (text && !isErr ? " busy" : "");
}

function refreshXhsCount() {
  $("#btnXhsClear").textContent = "清空 (" + xhsEvidence.length + ")";
  const hint = $("#xhsHint");
  if (xhsEvidence.length) {
    hint.style.display = "block";
    hint.textContent = "已收集 " + xhsEvidence.length + " 条小红书证据，点击「公司尽调 · 开始分析」将自动带入报告。";
  } else {
    hint.style.display = "none";
  }
}

async function loadXhsEvidence() {
  try {
    const d = await api.getStore(XHS_KEY);
    xhsEvidence = (d && d[XHS_KEY]) || [];
  } catch (e) { xhsEvidence = []; }
  refreshXhsCount();
}

$("#btnXhsOpen").onclick = async () => {
  const company = $("#coName").value.trim();
  if (!company) {
    setXhsStatus("请先在上方「公司名称」输入框填写要查的公司", true);
    $("#coName").focus();
    return;
  }
  const r = await api.xhsOpen(company);
  if (!r.ok) { setXhsStatus(r.error || "打开失败", true); return; }
  setXhsStatus("已在左侧打开小红书搜索「" + company + "」。登录后自行搜索，把结果粘贴到下方即可。");
};

$("#btnXhsAdd").onclick = async () => {
  const t = $("#xhsPaste").value.trim();
  if (!t) { setXhsStatus("请先粘贴小红书 AI 搜索的回答内容", true); return; }
  const pieces = t.split(/\n{2,}|(?=###|【)/).map((s) => s.trim()).filter((s) => s.length >= 4);
  if (!pieces.length) pieces.push(t);
  let added = 0;
  for (const p of pieces) {
    const n = "【小红书 AI 搜索】" + p;
    if (!xhsEvidence.includes(n)) { xhsEvidence.push(n); added++; }
  }
  if (added) await api.setStore({ [XHS_KEY]: xhsEvidence });
  $("#xhsPaste").value = "";
  setXhsStatus("已加入 " + added + " 条小红书证据");
  refreshXhsCount();
};

$("#btnXhsClear").onclick = async () => {
  xhsEvidence = [];
  await api.setStore({ [XHS_KEY]: [] });
  refreshXhsCount();
  setXhsStatus("已清空小红书证据");
};

$("#btnXhsBack").onclick = async () => {
  const r = await api.xhsBack();
  if (!r.ok) setXhsStatus(r.error || "返回失败", true);
  else setXhsStatus("已返回 BOSS 原页面");
};

// ============================================================
// 职位筛选
// ============================================================
function setFilterStatus(text, isErr) {
  const el = $("#filterStatus");
  el.textContent = text || "";
  el.className = "status" + (isErr ? " err" : "");
}

$("#btnApplyFilter").onclick = async () => {
  const r = await api.bossAction({
    type: "apply-filter",
    filter: {
      minK: $("#fMinK").value,
      maxK: $("#fMaxK").value,
      includeKw: $("#fInc").value,
      excludeKw: $("#fExc").value,
      excludeCompanies: $("#fExCo").value
    }
  });
  if (!r.ok) { setFilterStatus(r.error || "应用失败", true); return; }
  if (r.cleared) { setFilterStatus("条件为空，未应用筛选"); return; }
  if (!r.total) { setFilterStatus("当前页面没有职位卡片，请先打开职位列表页", true); return; }
  setFilterStatus("匹配 " + r.matched + " / 共 " + r.total + " 条" + (r.hidden ? "，已隐藏 " + r.hidden + " 条" : ""));
};

$("#btnClearFilter").onclick = async () => {
  const r = await api.bossAction({ type: "clear-filter" });
  if (!r.ok) { setFilterStatus(r.error || "还原失败", true); return; }
  setFilterStatus("已还原全部职位");
};

// ============================================================
// 岗位匹配
// ============================================================
let matchBusy = false;
let matchLastData = null;

function setMatchStatus(text, isErr) {
  const el = $("#matchStatus");
  el.textContent = text || "";
  el.className = "status" + (isErr ? " err" : "") + (text && !isErr ? " busy" : "");
}

function renderMatchMeta(ts, total, newCount) {
  const meta = $("#matchMeta");
  meta.style.display = "block";
  meta.textContent = "上次匹配：" + new Date(ts).toLocaleString() + " · 候选 " + total + " 个岗位" +
    (newCount > 0 ? " · 新发现高分岗位 " + newCount + " 个" : "");
}

function renderMatchResult(data) {
  matchLastData = data;
  const box = $("#matchResult");
  const matched = data.matched || [];
  if (!matched.length) {
    box.innerHTML = '<div class="hint" style="margin-top:10px;">没有可展示的匹配结果，请先点击「立即匹配」。</div>';
    return;
  }
  const sorted = [...matched].sort((a, b) => b.score - a.score);
  box.innerHTML = sorted.map((j) => {
    const cls = j.score >= 75 ? "strong" : j.score >= 60 ? "" : "lo";
    const scoreCls = j.score >= 75 ? "hi" : j.score >= 60 ? "mid" : "lo";
    const points = (j.matchPoints || []).map((p) => "<div>· <b>" + esc(p) + "</b></div>").join("");
    const gaps = (j.gaps || []).map((g) => "<div>· <span class='gap'>" + esc(g) + "</span></div>").join("");
    return '<div class="match-card ' + cls + '" data-href="' + esc(j.href || "") + '" title="点击在 BOSS 中打开岗位"' +
      (j.href ? ' style="cursor:pointer;"' : "") + '>' +
      '<div class="match-head"><span class="match-score ' + scoreCls + '">' + j.score + '</span>' +
      '<div style="min-width:0;"><div class="match-title">' + esc(j.title) + '</div>' +
      '<div class="match-sub">' + esc(j.company || "") + (j.salary ? " · " + esc(j.salary) : "") + '</div></div></div>' +
      (j.reason ? '<div class="match-reason">' + esc(j.reason) + '</div>' : "") +
      ((points || gaps) ? '<div class="match-points">' + points + gaps + '</div>' : "") +
      (j.href ? '<div class="match-open">→ 点击打开岗位</div>' : "") +
    '</div>';
  }).join("");
}

$("#matchResult").addEventListener("click", async (e) => {
  const card = e.target.closest(".match-card");
  if (!card) return;
  const href = card.dataset.href;
  if (!href) return;
  const r = await api.openJob(href);
  setMatchStatus(r.ok ? "已打开岗位详情（左侧 BOSS 视图）" : r.error || "打开失败", !r.ok);
});

$("#btnMatchRun").onclick = async () => {
  if (matchBusy) return;
  matchBusy = true;
  $("#btnMatchRun").disabled = true;
  $("#btnMatchStop").style.display = "block";
  setMatchStatus("匹配师：正在从职位库检索候选岗位，逐个思考打分…");
  setAgentState("busy", "岗位匹配师 · 检索与打分中…");
  $("#matchResult").innerHTML = "";
  const r = await api.matchRun();
  matchBusy = false;
  $("#btnMatchRun").disabled = false;
  $("#btnMatchStop").style.display = "none";
  if (!r.ok) {
    if (r.cancelled) { setMatchStatus("匹配已停止"); setAgentState("", "多智能体系统就绪"); return; }
    setMatchStatus(r.error || "匹配失败", true);
    setAgentState("", "多智能体系统就绪");
    return;
  }
  setAgentState("", "多智能体系统就绪");
  setMatchStatus(r.newOnes && r.newOnes.length ? "完成：检索 " + r.total + " 个岗位，发现 " + r.newOnes.length + " 个新高分岗位" : "完成：检索 " + r.total + " 个岗位，本次无新增高分岗位");
  renderMatchMeta(r.ts, r.total, r.newOnes ? r.newOnes.length : 0);
  renderMatchResult(r);
};

$("#btnMatchStop").onclick = async () => {
  const r = await api.agentCancel();
  if (r.ok && r.cancelled) setMatchStatus("正在停止…");
};

$("#matchInterval").onchange = () => {
  const enabled = Number($("#matchInterval").value) > 0;
  api.matchSchedule({
    enabled,
    intervalMin: enabled ? Number($("#matchInterval").value) : 0,
    threshold: Number($("#matchThreshold").value) || 70,
    extra: $("#matchExtra").value.trim()
  }).then((r) => {
    setMatchStatus(r.ok ? (enabled ? "定时刷新已开启（每 " + $("#matchInterval").value + " 分钟）" : "定时刷新已关闭") : "设置失败", !r.ok);
  });
};

$("#matchThreshold").onchange = () => {
  const enabled = Number($("#matchInterval").value) > 0;
  api.matchSchedule({
    enabled,
    intervalMin: enabled ? Number($("#matchInterval").value) : 0,
    threshold: Number($("#matchThreshold").value) || 70,
    extra: $("#matchExtra").value.trim()
  });
};

$("#matchExtra").onchange = () => {
  const enabled = Number($("#matchInterval").value) > 0;
  api.matchSchedule({
    enabled,
    intervalMin: enabled ? Number($("#matchInterval").value) : 0,
    threshold: Number($("#matchThreshold").value) || 70,
    extra: $("#matchExtra").value.trim()
  }).then((r) => {
    setMatchStatus($("#matchExtra").value.trim() ? "补充要求已保存，下次匹配生效" : "补充要求已清空");
  });
};

api.onMatchNew((data) => {
  const banner = $("#matchNewBanner");
  banner.style.display = "block";
  banner.textContent = "新匹配提醒：发现 " + data.count + " 个高分岗位（≥" + data.threshold + "分）——" +
    data.items.map((i) => i.title + "@" + i.company + "(" + i.score + ")").join("；");
  setTimeout(() => { banner.style.display = "none"; }, 15000);
  if (matchLastData) {
    const known = new Set((matchLastData.matched || []).map((j) => j.id));
    const merged = { ...matchLastData, matched: [...(matchLastData.matched || [])].concat(data.items.filter((i) => !known.has(i.id))) };
    renderMatchResult(merged);
  }
});

(async () => {
  try {
    const st = await api.matchStatus();
    if (st.ok) {
      if (st.settings.enabled) $("#matchInterval").value = String(st.settings.intervalMin || 30);
      if (st.settings.threshold) $("#matchThreshold").value = String(st.settings.threshold);
      if (st.settings.extra) $("#matchExtra").value = st.settings.extra;
      if (st.lastSkip && st.lastSkip.ts) {
        setMatchStatus("提示：上次定时匹配被跳过（" + (st.lastSkip.reason || "任务繁忙") + "），" + new Date(st.lastSkip.ts).toLocaleTimeString());
      }
    }
  } catch (e) {}
})();

// ============================================================
// 清理已读不回（超过1天）
// ============================================================
let cleanRunning = false;

function escHtml(s) {
  return String(s).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
}

function fmtTime(ts) {
  const d = new Date(ts);
  return (d.getMonth() + 1) + "月" + d.getDate() + "日 " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}

async function cleanUnreadFlow() {
  if (cleanRunning) return;
  setStatus("正在分析会话…");
  $("#content").innerHTML = "";
  const st = await api.bossAction({ type: "clean-unread-analyze" });
  if (!st.ok) { setStatus(st.error || "分析失败", true); return; }
  if (!st.count) { setStatus("没有找到超过1天未回的已读会话"); return; }
  setStatus("");
  renderCleanList(st.candidates || []);
}

function renderCleanList(cand) {
  const c = $("#content");
  c.innerHTML = "";
  const t = document.createElement("div");
  t.style.cssText = "font-weight:700;color:#1e6fff;font-size:13px;margin:10px 0 8px;";
  t.textContent = "发现 " + cand.length + " 个已读不回（>1天）的会话：";
  c.appendChild(t);
  const listEl = document.createElement("div");
  listEl.style.cssText = "max-height:260px;overflow-y:auto;border:1px solid #e4e8f0;border-radius:8px;padding:6px;margin-bottom:10px;";
  cand.forEach((x) => {
    const row = document.createElement("div");
    row.style.cssText = "font-size:12px;color:#445;line-height:1.6;padding:5px 4px;border-bottom:1px dashed #eef1f6;";
    row.innerHTML = "<b>" + escHtml(x.name) + "</b> · " + escHtml(x.brandName || "") + " <span style='color:#99a'>" + fmtTime(x.lastTS) + "</span><br><span style='color:#778'>" + escHtml((x.lastMsg || "").slice(0, 40)) + "</span>";
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
  okBtn.addEventListener("click", () => runCleanFlow(cand));
  cancelBtn.addEventListener("click", () => { $("#content").innerHTML = ""; setStatus("已取消"); });
  row2.appendChild(okBtn);
  row2.appendChild(cancelBtn);
  c.appendChild(row2);
}

async function runCleanFlow(cand) {
  if (cleanRunning) return;
  cleanRunning = true;
  const btn = $("#btnCleanUnread");
  btn.disabled = true;
  setStatus("正在删除已读不回会话（约 " + Math.ceil(cand.length * 2.5) + " 秒），请勿关闭页面…");
  $("#content").innerHTML = "";
  const st = await api.bossAction({ type: "clean-unread-run", candidates: cand, _timeout: 300000 });
  btn.disabled = false;
  cleanRunning = false;
  if (!st.ok) { setStatus(st.error || "删除失败", true); return; }
  setStatus("完成：成功删除 " + st.okCount + " 条" + (st.skipCount ? "，跳过 " + st.skipCount : "") + (st.failCount ? "，失败 " + st.failCount : ""));
  if (st.fails && st.fails.length) {
    const f = document.createElement("div");
    f.style.cssText = "font-size:12px;color:#d63031;line-height:1.6;margin-top:8px;";
    f.textContent = st.fails.join("；");
    $("#content").appendChild(f);
  }
  if (st.okCount > 0) {
    const reload = document.createElement("button");
    reload.className = "btn primary";
    reload.style.cssText = "margin-top:10px;width:100%;";
    reload.textContent = "刷新列表";
    reload.addEventListener("click", () => api.reloadBoss());
    $("#content").appendChild(reload);
  }
}

// ============================================================
// Tab
// ============================================================
function showTab(name) {
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
  document.querySelectorAll(".page").forEach((p) => p.classList.toggle("active", p.id === "tab-" + name));
}

// ============================================================
// 事件绑定
// ============================================================
$("#btnGreeting").onclick = () => runAction("greeting");
$("#btnReply").onclick = () => runAction("reply");
$("#btnLetter").onclick = showLetterForm;
$("#btnCleanUnread").onclick = cleanUnreadFlow;
$("#btnSave").onclick = saveSettings;
$("#btnTestApi").onclick = async () => {
  const el = $("#apiTestStatus");
  el.textContent = "测试中…";
  el.className = "status busy";
  const key = $("#apiKey").value.trim();
  if (!key) { el.textContent = "请先填写 API Key"; el.className = "status err"; return; }
  const d = await api.getStore("bossAiSettings");
  await api.setStore({ bossAiSettings: { ...(d.bossAiSettings || {}), apiKey: key } });
  const r = await api.testApi();
  if (r.ok) { el.textContent = "连接正常（" + (r.model || "") + "）：" + (r.text || ""); el.className = "status"; }
  else { el.textContent = r.error || "连接失败"; el.className = "status err"; }
};

async function renderUsageStats() {
  const r = await api.agentStats();
  const el = $("#usageStats");
  if (!r.ok || !r.stats) { el.textContent = "-"; return; }
  const s = r.stats;
  el.textContent = "模型调用 " + (s.calls || 0) + " 次 · 累计 Token " + (s.tokens || 0) + " · 失败 " + (s.errors || 0) + " 次";
}

async function renderLogBox() {
  const r = await api.readLog(100);
  const box = $("#logBox");
  if (!r.ok) { box.textContent = "读取日志失败：" + (r.error || ""); box.style.display = "block"; return; }
  if (!r.lines || !r.lines.length) { box.textContent = "暂无日志"; box.style.display = "block"; return; }
  box.textContent = r.lines.join("\n");
  box.style.display = "block";
}

$("#btnRefreshLog").onclick = renderLogBox;
$("#btnCopyLog").onclick = async () => {
  const box = $("#logBox");
  if (!box.textContent) await renderLogBox();
  try {
    await navigator.clipboard.writeText(box.textContent || "");
    $("#btnCopyLog").textContent = "已复制";
    setTimeout(() => ($("#btnCopyLog").textContent = "复制日志"), 1200);
  } catch (e) {}
};
$("#btnPrep").onclick = doPrep;
$("#btnFromChat").onclick = async () => {
  const r = await api.bossAction({ type: "get-chat-context" });
  if (!r.ok || !r.ctx) { setPrepStatus("当前不在聊天页，请手动填写", true); return; }
  if (r.ctx.company) $("#ivCompany").value = r.ctx.company;
  if (r.ctx.title) $("#ivTitle").value = r.ctx.title;
  if (r.ctx.jdDesc) $("#ivJd").value = r.ctx.jdDesc;
  setPrepStatus("已获取会话上下文");
};
$("#btnAddIv").onclick = () => {
  const f = $("#ivForm");
  f.style.display = f.style.display === "none" ? "block" : "none";
  if (f.style.display === "block") $("#ivRecCompany").focus();
};
$("#btnSaveIv").onclick = async () => {
  const rec = {
    id: Date.now().toString(36),
    company: $("#ivRecCompany").value.trim(),
    title: $("#ivRecTitle").value.trim(),
    date: $("#ivRecDate").value.trim(),
    status: $("#ivRecStatus").value,
    note: $("#ivRecNote").value.trim(),
    ts: Date.now()
  };
  if (!rec.company && !rec.title) { setPrepStatus("请至少填写公司或岗位", true); return; }
  const list = await loadInterviews();
  list.push(rec);
  await api.setStore({ [IV_KEY]: list });
  $("#ivForm").style.display = "none";
  $("#ivRecCompany").value = ""; $("#ivRecTitle").value = ""; $("#ivRecDate").value = ""; $("#ivRecNote").value = "";
  renderInterviewList();
};
$("#btnAddIvq").onclick = () => {
  const f = $("#ivqForm");
  f.style.display = f.style.display === "none" ? "block" : "none";
  if (f.style.display === "block") $("#ivqQuestion").focus();
};
$("#btnSaveIvq").onclick = async () => {
  const q = $("#ivqQuestion").value.trim();
  if (!q) { setPrepStatus("请填写问题内容", true); return; }
  const rec = {
    id: Date.now().toString(36),
    question: q,
    company: $("#ivqCompany").value.trim(),
    title: $("#ivqTitle").value.trim(),
    answer: $("#ivqAnswer").value.trim(),
    ts: Date.now()
  };
  const list = await loadQuestions();
  list.push(rec);
  await api.setStore({ [Q_KEY]: list });
  $("#ivqForm").style.display = "none";
  $("#ivqQuestion").value = ""; $("#ivqCompany").value = ""; $("#ivqTitle").value = ""; $("#ivqAnswer").value = "";
  renderQuestionList();
};
$("#btnCompany").onclick = doCompanyAnalyze;
$("#btnPickImage").onclick = async () => {
  const r = await api.pickImage();
  if (r && r.ok) {
    if (!r.canceled) {
      setStatus("已上传 " + ((r.added && r.added.length) || 0) + " 张图片");
      showTab("assist");
    }
    renderPanelImages();
  } else {
    setStatus("上传失败：" + ((r && r.error) || "未知错误"), true);
  }
};
$("#btnParse").onclick = doParseCompanies;
$("#btnBatchRun").onclick = runBatch;
  $("#btnRisk").onclick = doRiskCheck;
$("#btnCoFromJd").onclick = async () => {
  const r = await api.bossAction({ type: "getJd" });
  if (r.ok && r.jd && r.jd.company) {
    $("#coName").value = r.jd.company;
    setCoStatus("已填入：" + r.jd.company);
  } else {
    setCoStatus("未识别到当前职位公司，请手动输入", true);
  }
};
$("#btnPin").onclick = async () => {
  const r = await api.setPin();
  pinned = r.pinned;
  $("#btnPin").classList.toggle("on", pinned);
  $("#btnPinS").classList.toggle("on", pinned);
};
$("#btnReload").onclick = () => api.reloadBoss();
$("#btnBack").onclick = () => api.navBoss("back");
$("#btnForward").onclick = () => api.navBoss("forward");
$("#btnReloadS").onclick = () => api.reloadBoss();
$("#btnPinS").onclick = () => $("#btnPin").click();
$("#btnCollapse").onclick = () => api.collapse();
$("#btnExpand").onclick = () => api.expand();
$("#btnClearActivity").onclick = async () => {
  await api.agentLogClear();
  renderActivity();
};
$("#zoomOut").onclick = () => setZoom(Math.round(((zoomManual ? zoomVal : 1) - 0.05) * 100) / 100);
$("#zoomIn").onclick = () => setZoom(Math.round(((zoomManual ? zoomVal : 1) + 0.05) * 100) / 100);
$("#zoomLabel").onclick = () => setZoom("auto");
document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => showTab(t.dataset.tab)));

// 智能体事件流
api.onAgentEvent((ev) => {
  if (!ev || !ev.type) return;
  if (ev.type === "agent:start") {
    setAgentState("busy", ev.agentName + " · 执行中…");
    const stop = $("#btnStopAgent");
    if (stop) stop.style.display = "block";
  } else if (ev.type === "agent:done" || ev.type === "agent:cancelled") {
    setAgentState("", ev.type === "agent:cancelled" ? "任务已停止" : "多智能体系统就绪");
    const stop = $("#btnStopAgent");
    if (stop) stop.style.display = "none";
    renderActivity();
  } else if (ev.type === "agent:error") {
    setAgentState("err", "智能体执行失败");
    const stop = $("#btnStopAgent");
    if (stop) stop.style.display = "none";
    renderActivity();
  } else if (ev.type === "progress") {
    if (ev.intent === "match") {
      setMatchStatus("匹配师：「" + (ev.label || "") + "」…");
    } else if (ev.intent === "risk") {
      const steps = 3;
      const pct = Math.min(0.95, (ev.total || 0) / steps * 0.95);
      setCoProgress(true, pct, "阶段 " + (ev.total || 0) + "/" + steps + " · " + (ev.label || ""));
      setCoStatus("避雷速查师：「" + (ev.label || "") + "」…");
    } else {
      const steps = 5;
      const pct = Math.min(0.95, (ev.total || 0) / steps * 0.95);
      setCoProgress(true, pct, "阶段 " + (ev.total || 0) + "/" + steps + " · " + (ev.label || ""));
      setCoStatus("尽调分析师：「" + (ev.label || "") + "」…");
    }
  }
});

$("#btnStopAgent").onclick = async () => {
  const r = await api.agentCancel();
  if (r.ok && r.cancelled) {
    setAgentState("", "正在停止…");
  }
};

// 对话助手
$("#chatSend").onclick = sendChat;
$("#chatInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    sendChat();
  }
});
$("#modeChat").onclick = () => { chatMode = "chat"; renderChatMode(); };
$("#modeForm").onclick = () => { chatMode = "form"; renderChatMode(); };
$("#chatClear").onclick = async () => {
  if (!chatHistory.length) return;
  chatHistory = [];
  await api.setStore({ [CHAT_KEY]: [] });
  renderChat();
};

api.onStoreChanged((key) => {
  if (key === "bossAiSettings") { loadSettings(); }
  if (key === "bossAiPendingGreeting") { renderPending(); }
});
api.onNav((section) => { if (section === "settings") showTab("settings"); });

// 初始化
bindResumeEvents();
loadSettings();
renderPending();
renderChat();
renderChatMode();
renderInterviewList();
renderQuestionList();
renderPanelImages();
renderActivity();
refreshZoom();
loadXhsEvidence();
renderUsageStats();