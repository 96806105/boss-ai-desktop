/**
 * ApplicationAgent v2（重构版）：
 * 使用 AgentBase + prompt 模板
 */
const { AgentBase } = require("./agent-base");
const { resolveResume } = require("../core/store");
const { DEFAULT_FORBIDDEN } = require("../skills/communication/index");

class ApplicationAgent extends AgentBase {
  constructor({ learningAdapter } = {}) {
    super({
      id: "application",
      name: "求职信助手",
      role: "正式求职信撰写",
      description: "基于岗位信息与简历，撰写一封正式、有力的求职信（自荐信）",
      temperature: 0.6,
      learningAdapter
    });
  }

  buildMessages(input, { settings } = {}) {
    const { company, title, salary, jdDesc, resumeText, extra } = input || {};
    const resume = resumeText || resolveResume(settings);

    const sys = this.renderPrompt("system.md", {
      forbiddenWords: DEFAULT_FORBIDDEN.join("、")
    });

    const user =
      "【目标公司】" + (company || "未知") +
      "\n【目标岗位】" + (title || "未知") + (salary ? "（" + salary + "）" : "") +
      "\n【职位描述】\n" + (jdDesc || "无") +
      (extra ? "\n【补充要求】\n" + extra : "") +
      "\n\n【我的简历】\n" + (resume || "（未提供简历）");

    return [{ role: "system", content: sys }, { role: "user", content: user }];
  }
}

module.exports = { ApplicationAgent };
