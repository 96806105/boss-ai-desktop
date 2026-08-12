const logger = require("../core/logger");

/**
 * BaseAgent：所有专业智能体的基类。
 * 生命周期：resolveTools → buildMessages → llm.call → 返回 { text, meta }
 * 每个 Agent 有独立的角色（role）、系统提示词、温度、可用工具与模型。
 */
class BaseAgent {
  constructor({ id, name, role, description, systemPrompt, temperature = 0.7, useTools = [], model = null, maxRetries = 2 }) {
    this.id = id;
    this.name = name;
    this.role = role;
    this.description = description;
    this.systemPrompt = systemPrompt;
    this.temperature = temperature;
    this.useTools = useTools; // 工具 id 列表
    this.model = model;
    this.maxRetries = maxRetries;
  }

  /**
   * 解析工具上下文：调用本 Agent 声明的工具，返回注入提示词的内容。
   * 子类可覆写；默认静默容错（工具失败不阻塞主流程）。
   * @returns {Promise<string>} 追加到用户消息的工具情报文本
   */
  async resolveTools(input, ctx) {
    if (!this.useTools || !this.useTools.length) return "";
    const parts = [];
    for (const toolId of this.useTools) {
      const tool = ctx.tools[toolId];
      if (!tool) continue;
      try {
        const result = await tool.run(this.buildToolArgs(input, toolId), { signal: ctx.signal });
        if (result && result.length) {
          parts.push(JSON.stringify(result));
        }
      } catch (err) {
        logger.warn("agent." + this.id, "tool", toolId, "failed:", err.message);
      }
    }
    if (!parts.length) return "";
    return "\n【工具检索到的公开信息】\n" + parts.join("\n\n");
  }

  /** 子类可覆写：为工具组装参数。默认返回 { company, keywords } 形式。 */
  buildToolArgs() {
    return {};
  }

  buildMessages(input, ctx) {
    return [{ role: "system", content: this.systemPrompt }, { role: "user", content: String(input) }];
  }

  async execute(input, ctx) {
    const started = Date.now();
    logger.info("agent." + this.id, "start task=", String(input).slice(0, 120));
    const toolCtx = await this.resolveTools(input, ctx);
    const messages = this.buildMessages(input, ctx);
    if (toolCtx && messages[messages.length - 1]) {
      messages[messages.length - 1].content += toolCtx;
    }
    const settings = ctx.settings || {};
    const { text, usage } = await ctx.llm.call({
      apiKey: settings.apiKey,
      model: this.model || settings.model,
      messages,
      temperature: this.temperature,
      maxRetries: this.maxRetries
    });
    logger.info("agent." + this.id, "done in", Date.now() - started, "ms, chars=", text.length);
    return { text, meta: { agent: this.id, agentName: this.name, ms: Date.now() - started, usage } };
  }
}

module.exports = { BaseAgent };