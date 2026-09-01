/**
 * CompanyParseAgent v2（重构版）：
 * 使用 AgentBase + prompt 模板
 */
const { AgentBase } = require("./agent-base");

class CompanyParseAgent extends AgentBase {
  constructor({ learningAdapter } = {}) {
    super({
      id: "company-parse",
      name: "公司名解析器",
      role: "从段落文本中提取公司名称",
      description: "从用户粘贴的文本中识别并标准化公司名称列表",
      temperature: 0.1,
      learningAdapter
    });
  }

  buildMessages(input, ctx) {
    const text = String((input && input.text) || "").slice(0, 6000);
    const candidates = Array.isArray(input && input.candidates) ? input.candidates.slice(0, 30) : [];

    const sys = this.renderPrompt("system.md");
    const user =
      (candidates.length ? "【候选名单（预提取，可能含误报）】\n" + candidates.map((c, i) => (i + 1) + ". " + c).join("\n") + "\n\n" : "") +
      "【文本内容】\n" + text;

    return [{ role: "system", content: sys }, { role: "user", content: user }];
  }
}

module.exports = { CompanyParseAgent };
