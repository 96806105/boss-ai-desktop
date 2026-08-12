const api = window.panelApi;
const $ = (sel) => document.querySelector(sel);
const AGENT_ICONS = {
  greeting: "i-spark",
  reply: "i-chat",
  interview: "i-briefcase",
  company: "i-building",
  application: "i-file"
};

let settings = null;
let pinned = false;
let busy = false;
let prepBusy = false;
let coBusy = false;
let zoomManual = false;
let zoomVal = null;

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
async function loadSettings() {
  const d = await api.getStore("bossAiSettings");
  settings = d.bossAiSettings || {};
  $("#apiKey").value = settings.apiKey || "";
  $("#model").value = settings.model || "deepseek-chat";
  $("#style").value = settings.style || "prof";
  $("#customPrompt").value = settings.customPrompt || "";
  $("#resumeText").value = settings.resumeText || "";
  $("#autoReply").checked = settings.autoReply !== false;
  $("#cooldown").value = settings.cooldown || 10;
  $("#maxContext").value = settings.maxContext || 8;
  applyTheme();
  refreshStatus();
}

async function saveSettings() {
  const obj = {
    apiKey: $("#apiKey").value.trim(),
    model: $("#model").value,
    style: $("#style").value,
    customPrompt: $("#customPrompt").value.trim(),
    resumeText: $("#resumeText").value,
    autoReply: $("#autoReply").checked,
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
  parts.push(s.resumeText ? '<span class="st ok">简历</span>' : '<span class="st no">简历</span>');
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
  const entries = (r.ok ? r.log : []).filter((e) => e.type === "done" || e.type === "error");
  if (!entries.length) {
    box.innerHTML = '<div class="act-empty">暂无智能体任务记录</div>';
    return;
  }
  box.innerHTML = "";
  for (const e of entries.slice(0, 12)) {
    const item = document.createElement("div");
    item.className = "act-item";
    const icon = AGENT_ICONS[e.agent] || "i-spark";
    const sub = e.type === "error" ? "执行失败：" + (e.error || "") : "耗时 " + (e.ms ? (e.ms / 1000).toFixed(1) + " 秒" : "-") + (e.chars ? " · " + e.chars + " 字符" : "");
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
// 生成（招呼语 / 回复）
// ============================================================
async function runAction(kind) {
  if (busy) return;
  await loadSettings();
  if (!settings.apiKey) { setStatus("未配置 API Key，请在设置页填写", true); showTab("settings"); return; }
  if (kind === "greeting" && !settings.resumeText) {
    setStatus("未配置简历，生成效果会变差（可在设置页粘贴简历）", true);
  }
  $("#content").innerHTML = "";
  busy = true;
  $("#btnGreeting").disabled = true;
  $("#btnReply").disabled = true;
  setStatus("正在生成…（模型思考约 10~40 秒）");
  const res = await api.bossAction({ type: "generate-now", kind });
  busy = false;
  $("#btnGreeting").disabled = false;
  $("#btnReply").disabled = false;
  if (!res.ok) { setStatus(res.error || "生成失败", true); return; }
  setStatus("");
  if (kind === "greeting") {
    renderGreeting(res.res);
    renderPending();
  } else {
    renderReply(res.res);
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
      resumeText: settings.resumeText || ""
    });
    busy = false;
    $("#ltGenerate").disabled = false;
    if (!r.ok) { $("#ltStatus").textContent = r.error || "生成失败"; $("#ltStatus").className = "status err"; setAgentState("err", "求职信生成失败"); return; }
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
    resumeText: settings.resumeText || ""
  });
  prepBusy = false;
  $("#btnPrep").disabled = false;
  if (!r.ok) { setPrepStatus(r.error || "生成失败", true); setAgentState("err", "面试准备生成失败"); return; }
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
  if (window.__xhsEvidence && window.__xhsEvidence.length) input.xhsNotes = window.__xhsEvidence;
  const r = await api.agentInvoke("company", input);
  coBusy = false;
  $("#btnCompany").disabled = false;
  setCoProgress(false);
  if (!r.ok) { setCoStatus(r.error || "分析失败", true); setAgentState("err", "尽调分析失败"); return; }
  setCoStatus("");
  setAgentState("", "多智能体系统就绪");
  $("#coResult").innerHTML = '<div class="ver"><div class="txt">' + renderMd(r.text) + "</div><div class='ops'><button class='btn secondary sm' id='coCopy'>复制报告</button></div></div>";
  $("#coCopy").onclick = async () => {
    try { await navigator.clipboard.writeText(r.text); $("#coCopy").textContent = "已复制"; } catch (e) {}
  };
}

// ============================================================
// 小红书 AI 搜索 · 舆情证据采集
// ============================================================
window.__xhsEvidence = [];

function setXhsStatus(text, isErr) {
  const el = $("#xhsStatus");
  el.textContent = text || "";
  el.className = "status" + (isErr ? " err" : "") + (text && !isErr ? " busy" : "");
}

function refreshXhsCount() {
  $("#btnXhsClear").textContent = "清空 (" + window.__xhsEvidence.length + ")";
  const hint = $("#xhsHint");
  if (window.__xhsEvidence.length) {
    hint.style.display = "block";
    hint.textContent = "已收集 " + window.__xhsEvidence.length + " 条小红书证据，点击「公司尽调 · 开始分析」将自动带入报告。";
  } else {
    hint.style.display = "none";
  }
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

$("#btnXhsAdd").onclick = () => {
  const t = $("#xhsPaste").value.trim();
  if (!t) { setXhsStatus("请先粘贴小红书 AI 搜索的回答内容", true); return; }
  const pieces = t.split(/\n{2,}|(?=###|【)/).map((s) => s.trim()).filter((s) => s.length >= 4);
  if (!pieces.length) pieces.push(t);
  for (const p of pieces) {
    if (!window.__xhsEvidence.includes(p)) window.__xhsEvidence.push("【小红书 AI 搜索】" + p);
  }
  $("#xhsPaste").value = "";
  setXhsStatus("已加入 " + pieces.length + " 条小红书证据");
  refreshXhsCount();
};

$("#btnXhsClear").onclick = () => {
  window.__xhsEvidence = [];
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
  setMatchStatus("匹配师：正在从职位库检索候选岗位，逐个思考打分…");
  $("#matchResult").innerHTML = "";
  const r = await api.matchRun();
  matchBusy = false;
  $("#btnMatchRun").disabled = false;
  if (!r.ok) { setMatchStatus(r.error || "匹配失败", true); return; }
  setMatchStatus(r.newOnes && r.newOnes.length ? "完成：检索 " + r.total + " 个岗位，发现 " + r.newOnes.length + " 个新高分岗位" : "完成：检索 " + r.total + " 个岗位，本次无新增高分岗位");
  renderMatchMeta(r.ts, r.total, r.newOnes ? r.newOnes.length : 0);
  renderMatchResult(r);
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
    }
  } catch (e) {}
})();

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
$("#btnSave").onclick = saveSettings;
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
$("#btnCompany").onclick = doCompanyAnalyze;
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
$("#btnGoChat").onclick = () => api.gotoChat();
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
  } else if (ev.type === "agent:done") {
    setAgentState("", "多智能体系统就绪");
    renderActivity();
  } else if (ev.type === "agent:error") {
    setAgentState("err", "智能体执行失败");
    renderActivity();
  } else if (ev.type === "progress") {
    const steps = 5;
    const pct = Math.min(0.95, (ev.total || 0) / steps * 0.95);
    setCoProgress(true, pct, "阶段 " + (ev.total || 0) + "/" + steps + " · " + (ev.label || ""));
    setCoStatus("尽调分析师：「" + (ev.label || "") + "」…");
  }
});

api.onStoreChanged((key) => {
  if (key === "bossAiSettings") { loadSettings(); }
  if (key === "bossAiPendingGreeting") { renderPending(); }
});
api.onNav((section) => { if (section === "settings") showTab("settings"); });

// 初始化
loadSettings();
renderPending();
renderInterviewList();
renderActivity();
refreshZoom();