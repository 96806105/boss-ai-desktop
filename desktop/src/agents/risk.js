/**
 * RiskAgent v2（重构版）：
 * 使用 AgentBase + prompt 模板
 */
const { AgentBase } = require("./agent-base");
const logger = require("../core/logger");
const { multiSearch } = require("../core/tools");

class RiskAgent extends AgentBase {
  constructor({ learningAdapter } = {}) {
    super({
      id: "risk",
      name: "避雷速查师",
      role: "求职风险速查",
      description: "快速核查公司司法风险与招聘口碑，输出风险等级与避雷结论",
      temperature: 0.3,
      learningAdapter
    });
  }

  async execute(input, ctx) {
    const company = String((input && input.company) || (typeof input === "string" ? input : "") || "").trim();
    if (!company) throw new Error("未识别到公司名称，请打开职位详情或聊天窗口后重试");
    const jd = (input && input.jd) || {};
    const chatText = String((input && input.chatText) || "").slice(0, 2000);
    const started = Date.now();
    logger.info("agent.risk", "start", company);
    const onProgress = ctx.onProgress || (() => {});
    const q = (kw) => '"' + company + '"' + (kw ? " " + kw : "");
    const sig = ctx.signal;
    const checkAbort = () => { if (sig && sig.aborted) throw new Error("任务已取消"); };

    onProgress("司法与经营风险检索", 1);
    const phase1 = await Promise.all([
      multiSearch([{ label: "司法", engines: ["baidu", "bing"], q: q("诉讼 被执行 失信 裁判文书") }], null, sig),
      multiSearch([{ label: "经营风险", engines: ["bing", "baidu"], q: q("处罚 行政处罚 经营异常") }], null, sig)
    ]);
    checkAbort();

    onProgress("招聘口碑检索", 2);
    const phase2 = await Promise.all([
      multiSearch([{ label: "招聘口碑", engines: ["baidu", "sogou"], q: q("招聘 工资 拖欠 投诉 加班") }], null, sig),
      multiSearch([{ label: "口碑避雷", engines: ["bing", "baidu"], q: q("小红书 口碑 评价 避雷") }], null, sig)
    ]);
    checkAbort();

    onProgress("生成风险结论", 3);

    const all = [...phase1.flat(), ...phase2.flat()];
    const seen = new Set();
    const uniq = all.filter((it) => { const k = it.title + it.href; if (seen.has(k)) return false; seen.add(k); return true; });
    const evidence = uniq.map((it) =>
      "· " + it.title + (it.snip ? " —— " + it.snip : "") + " [" + it.engine + "|" + (it.label || "other") + "]"
    ).slice(0, 24).join("\n") || "（未检索到与该公司的相关公开条目）";

    const sys = this.renderPrompt("system.md");
    const user =
      "【目标公司】" + company + "\n" +
      (jd && jd.title ? "【招聘岗位】" + jd.title + (jd.salary ? "（" + jd.salary + "）" : "") + "\n" : "") +
      (jd && jd.desc ? "【岗位描述摘录】" + String(jd.desc).slice(0, 800) + "\n" : "") +
      (chatText ? "【与 HR 的聊天片段】" + chatText + "\n" : "") +
      "\n【公开检索证据】\n" + evidence;

    const { text, usage } = await ctx.llm.call({
      apiKey: ctx.settings.apiKey,
      model: ctx.settings.model,
      messages: [{ role: "system", content: sys }, { role: "user", content: user }],
      temperature: 0.3,
      signal: sig
    });
    logger.info("agent.risk", "done in", Date.now() - started, "ms, evidence=", uniq.length);
    return { text, meta: { agent: this.id, agentName: this.name, ms: Date.now() - started, usage, evidenceRows: uniq.length } };
  }
}

module.exports = { RiskAgent };
