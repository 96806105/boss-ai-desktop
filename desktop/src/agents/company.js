/**
 * CompanyAgent v3（重构版）：
 * 使用 AgentBase + prompt 模板 + web-intelligence skill
 */
const { AgentBase } = require("./agent-base");
const logger = require("../core/logger");
const { multiSearch, extractFields, fetchBaike } = require("../core/tools");

class CompanyAgent extends AgentBase {
  constructor({ learningAdapter } = {}) {
    super({
      id: "company",
      name: "尽调分析师",
      role: "商业背景调查",
      description: "三引擎并行采集工商信息/司法风险/平台口碑，输出结构化尽调报告",
      temperature: 0.4,
      learningAdapter
    });
  }

  async execute(input, ctx) {
    const company = String((input && input.company) || (typeof input === "string" ? input : "") || "").trim();
    if (!company) throw new Error("请输入公司名称");
    const xhsNotes = ((input && input.xhsNotes) || []).map((t) => String(t).trim()).filter(Boolean).slice(0, 60);
    const started = Date.now();
    logger.info("agent.company", "start", company);
    const onProgress = ctx.onProgress || (() => {});
    const q = (kw) => '"' + company + '"' + (kw ? " " + kw : "");
    const checkAbort = () => { if (ctx.signal && ctx.signal.aborted) throw new Error("任务已取消"); };

    onProgress("工商与基本信息", 1);
    const sig = ctx.signal;
    const phase1 = await Promise.all([
      multiSearch([{ label: "basic", engines: ["baidu", "sogou", "bing"], q: q("") }], null, sig),
      multiSearch([{ label: "工商", engines: ["baidu", "bing"], q: q("注册资本 实缴 法定代表人") }], null, sig),
      multiSearch([{ label: "工商2", engines: ["sogou", "baidu"], q: q("企业信息 工商 信用") }], null, sig),
      multiSearch([{ label: "信用报告", engines: ["sogou", "bing"], q: q("企业信用报告 启信宝 企查查") }], null, sig)
    ]);
    checkAbort();

    onProgress("司法与经营风险", 2);
    const phase2 = await Promise.all([
      multiSearch([{ label: "司法", engines: ["baidu", "bing"], q: q("诉讼 被执行 失信 裁判文书") }], null, sig),
      multiSearch([{ label: "风险", engines: ["bing", "baidu"], q: q("处罚 行政处罚 经营异常") }], null, sig)
    ]);
    checkAbort();

    onProgress("舆情与平台口碑", 3);
    const phase3 = await Promise.all([
      multiSearch([{ label: "招聘口碑", engines: ["baidu", "sogou"], q: q("招聘 工资 拖欠 投诉 加班") }], null, sig),
      multiSearch([{ label: "平台口碑", engines: ["bing", "baidu"], q: q("小红书 口碑 评价 避雷") }], null, sig),
      multiSearch([{ label: "行业舆情", engines: ["bing"], q: q("新闻 报道 舆情") }], null, sig)
    ]);
    checkAbort();

    onProgress("整合证据与档案字段", 4);
    const all = [...phase1.flat(), ...phase2.flat(), ...phase3.flat()];
    const seen = new Set();
    const uniq = all.filter((it) => { const k = it.title + it.href; if (seen.has(k)) return false; seen.add(k); return true; });

    const texts = uniq.map((it) => it.title + (it.snip ? " " + it.snip : ""));
    const fields = extractFields(texts);

    let baike = null;
    const baikeHit = uniq.find((it) => /baike\.baidu\.com\/item/.test(it.href));
    if (baikeHit) {
      baike = await fetchBaike(baikeHit.href, sig);
      if (baike && Object.keys(baike.fields || {}).length) {
        for (const [k, v] of Object.entries(baike.fields)) fields[k] = { value: v, count: 1, candidates: [v] };
      }
    }
    checkAbort();

    if (uniq.length < 3) throw new Error("未获取到足够的搜索结果（可能触发反爬或网络受限），请稍后重试");

    const byLabel = {};
    for (const it of uniq) {
      const key = it.label || "other";
      (byLabel[key] = byLabel[key] || []).push("· " + it.title + (it.snip ? " —— " + it.snip : "") + " [" + it.engine + "]");
    }
    const sections = Object.entries(byLabel).map(([k, v]) => "【" + k + "】\n" + v.slice(0, 8).join("\n"));
    if (xhsNotes.length) {
      const seenN = new Set();
      const uniqN = xhsNotes.filter((t) => { if (seenN.has(t)) return false; seenN.add(t); return true; });
      sections.push("【小红书站内采集】\n" + uniqN.slice(0, 30).map((t) => "· " + t.slice(0, 400)).join("\n"));
    }
    const fieldTable = Object.keys(fields).length
      ? Object.entries(fields).map(([k, v]) => "| " + k + " | " + v.value + " | 命中" + v.count + "处 |" + (v.candidates && v.candidates.length > 1 ? "（候选：" + v.candidates.join("、") + "）" : "")).join("\n")
      : "（未抽取到结构化字段）";

    onProgress("生成报告", 5);

    const sys = this.renderPrompt("system.md");
    const user =
      "【目标公司】" + company + "\n\n" +
      "【结构化工商字段】\n" + fieldTable + "\n\n" +
      (baike && Object.keys(baike.fields || {}).length ? "【百度百科词条】" + baike.title + "\n" + Object.entries(baike.fields).map(([k, v]) => k + "：" + v).join("\n") + "\n\n" : "") +
      "【多渠道检索证据】\n" + sections.join("\n\n").slice(0, 16000);

    const { text, usage } = await ctx.llm.call({
      apiKey: ctx.settings.apiKey,
      model: ctx.settings.model,
      messages: [{ role: "system", content: sys }, { role: "user", content: user }],
      temperature: 0.4,
      signal: sig
    });
    logger.info("agent.company", "done in", Date.now() - started, "ms, evidence=", uniq.length);
    return { text, meta: { agent: this.id, agentName: this.name, ms: Date.now() - started, usage, evidenceRows: uniq.length, fields: Object.keys(fields) } };
  }
}

module.exports = { CompanyAgent };
