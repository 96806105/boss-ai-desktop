/**
 * ChatAgent v2（重构版）：
 * 使用 AgentBase + prompt 模板
 */
const { AgentBase } = require("./agent-base");
const { resolveResume } = require("../core/store");
const { DEFAULT_FORBIDDEN } = require("../skills/communication/index");

function buildJdBlock(jd) {
  if (!jd || !jd.title) return "";
  const parts = ["职位：" + String(jd.title)];
  if (jd.company) parts.push("公司：" + String(jd.company));
  if (jd.salary) parts.push("薪资：" + String(jd.salary));
  const desc = String(jd.desc || "").trim();
  parts.push(desc ? "职位描述：\n" + desc.slice(0, 1500) : "职位描述：（未获取到详情）");
  return "\n\n【当前岗位信息（JD）】\n" + parts.join("\n");
}

class ChatAgent extends AgentBase {
  constructor({ learningAdapter } = {}) {
    super({
      id: "chat",
      name: "对话助手",
      role: "通用求职问答",
      description: "任何求职问题都能问，支持问卷逐题作答",
      temperature: 0.7,
      learningAdapter
    });
  }

  buildMessages({ messages, mode, settings, jd }) {
    const s = settings || {};
    const resume = resolveResume(s);
    const base = this.renderPrompt(mode === "form" ? "form.md" : "system.md");
    const jdBlock = buildJdBlock(jd);
    const resumeBlock = String(resume).trim()
      ? "\n\n【我的简历（涉及个人经历时以此为唯一事实来源）】\n" + String(resume).trim()
      : "\n\n（当前未提供简历：涉及个人经历的问题给出\"需本人补充\"的提示，不要编造）";
    const custom = s.customPrompt && String(s.customPrompt).trim()
      ? "\n\n【用户自定义要求（必须遵守）】\n" + String(s.customPrompt).trim()
      : "";
    const sys = base + jdBlock + resumeBlock + custom;

    const msgs = [{ role: "system", content: sys }];
    const raw = Array.isArray(messages)
      ? messages.filter((m) => m && (m.role === "user" || m.role === "assistant") && m.content)
      : [];
    let last = "system";
    for (const m of raw.slice(-16)) {
      if (m.role === last) continue;
      msgs.push({ role: m.role, content: String(m.content).slice(0, 8000) });
      last = m.role;
    }
    while (msgs.length > 1 && msgs[msgs.length - 1].role !== "user") msgs.pop();
    if (msgs.length === 1) msgs.push({ role: "user", content: "你好，介绍一下你能在求职中帮我做什么。" });
    return msgs;
  }
}

module.exports = { ChatAgent };
