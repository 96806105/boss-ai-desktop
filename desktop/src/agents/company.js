const { BaseAgent } = require("./base");
const logger = require("../core/logger");
const { multiSearch, extractFields, fetchBaike } = require("../core/tools");

/**
 * 公司尽调 Agent v2（企业级采集管线）：
 * 阶段1 工商与基本信息（百度/搜狗/Bing 三引擎并行）
 * 阶段2 司法与经营风险
 * 阶段3 舆情与平台口碑（含招聘/拖欠线索）
 * 阶段4 百度百科 infobox + 正则字段抽取（注册资本/实缴/法人/成立/信用代码…）
 * 证据先行 → LLM 撰写带"基础档案"的尽调报告
 */
class CompanyAgent extends BaseAgent {
  constructor() {
    super({
      id: "company",
      name: "尽调分析师",
      role: "商业背景调查",
      description: "三引擎并行采集工商信息/司法风险/平台口碑，输出结构化尽调报告",
      temperature: 0.4
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

    // ---------- 阶段1：工商与基本信息（并行） ----------
    onProgress("工商与基本信息", 1);
    const phase1 = await Promise.all([
      multiSearch([{ label: "basic", engines: ["baidu", "sogou", "bing"], q: q("") }]),
      multiSearch([{ label: "工商", engines: ["baidu", "bing"], q: q("注册资本 实缴 法定代表人") }]),
      multiSearch([{ label: "工商2", engines: ["sogou", "baidu"], q: q("企业信息 工商 信用") }]),
      multiSearch([{ label: "信用报告", engines: ["sogou", "bing"], q: q("企业信用报告 启信宝 企查查") }])
    ]);

    // ---------- 阶段2：司法与经营风险（并行） ----------
    onProgress("司法与经营风险", 2);
    const phase2 = await Promise.all([
      multiSearch([{ label: "司法", engines: ["baidu", "bing"], q: q("诉讼 被执行 失信 裁判文书") }]),
      multiSearch([{ label: "风险", engines: ["bing", "baidu"], q: q("处罚 行政处罚 经营异常") }])
    ]);

    // ---------- 阶段3：舆情与平台口碑（并行） ----------
    onProgress("舆情与平台口碑", 3);
    const phase3 = await Promise.all([
      multiSearch([{ label: "招聘口碑", engines: ["baidu", "sogou"], q: q("招聘 工资 拖欠 投诉 加班") }]),
      multiSearch([{ label: "平台口碑", engines: ["bing", "baidu"], q: q("小红书 口碑 评价 避雷") }]),
      multiSearch([{ label: "行业舆情", engines: ["bing"], q: q("新闻 报道 舆情") }])
    ]);

    // ---------- 阶段4：百科 infobox + 字段抽取 ----------
    onProgress("整合证据与档案字段", 4);
    const all = [...phase1.flat(), ...phase2.flat(), ...phase3.flat()];
    const seen = new Set();
    const uniq = all.filter((it) => { const k = it.title + it.href; if (seen.has(k)) return false; seen.add(k); return true; });

    const texts = uniq.map((it) => it.title + (it.snip ? " " + it.snip : ""));
    const fields = extractFields(texts);

    let baike = null;
    const baikeHit = uniq.find((it) => /baike\.baidu\.com\/item/.test(it.href));
    if (baikeHit) {
      baike = await fetchBaike(baikeHit.href);
      if (baike && Object.keys(baike.fields || {}).length) {
        for (const [k, v] of Object.entries(baike.fields)) fields[k] = { value: v, count: 1, candidates: [v] };
      }
    }

    if (uniq.length < 3) throw new Error("未获取到足够的搜索结果（可能触发反爬或网络受限），请稍后重试");

    // ---------- 证据组装 ----------
    const byLabel = {};
    for (const it of uniq) {
      const key = it.label || "other";
      (byLabel[key] = byLabel[key] || []).push("· " + it.title + (it.snip ? " —— " + it.snip : "") + " [" + it.engine + "]");
    }
    const sections = Object.entries(byLabel).map(([k, v]) => "【" + k + "】\n" + v.slice(0, 8).join("\n"));
    if (xhsNotes.length) {
      const seenN = new Set();
      const uniqN = xhsNotes.filter((t) => { if (seenN.has(t)) return false; seenN.add(t); return true; });
      sections.push("【小红书站内采集（用户在小红书中亲自检索/粘贴，可信度高；含笔记标题、作者、点赞数）】\n" + uniqN.slice(0, 30).map((t) => "· " + t.slice(0, 400)).join("\n"));
    }
    const fieldTable = Object.keys(fields).length
      ? Object.entries(fields).map(([k, v]) => "| " + k + " | " + v.value + " | 命中" + v.count + "处 |" + (v.candidates && v.candidates.length > 1 ? "（候选：" + v.candidates.join("、") + "）" : "")).join("\n")
      : "（未抽取到结构化字段）";

    onProgress("生成报告", 5);

    const sys =
      "你是资深商业尽调分析师（背景调查方向）。用户提供某公司名的多渠道公开检索证据（多搜索引擎标题+摘要、结构化工商字段、百科词条），" +
      "你要输出一份客观、克制、可执行的尽调报告。规则：\n" +
      "1) 报告必须包含「企业基础档案」表格（注册资本/实缴/成立时间/法定代表人/统一社会信用代码/经营状态/参保人数——能查到的填，查不到写\"未检索到\"）；\n" +
      "2) 只有证据中出现的事实才能写入，禁止编造或推断具体金额、日期、判决结果；证据冲突时并列呈现并标注（候选值按\"命中次数\"排序，优先采纳命中多的）；\n" +
      "3) 重要：证据中标题含\"成立/设立/新设/全资/子公司/拿下/落子\"等词的条目是目标公司旗下新设的公司，其注册资本、法定代表人等数据属于关联公司，不得写入目标公司的基础档案；只有标题或摘要明确指向\"目标公司全称\"的条目才可用于档案字段；\n" +
      "4) 负面信息如实呈现但不夸大，正负面平衡；区分\"事实\"与\"需进一步核实\"；\n" +
      "5) 输出 Markdown，固定结构：\n" +
      "## 一、企业基础档案（表格）\n" +
      "## 二、经营与司法风险（诉讼、被执行、失信、处罚、经营异常）\n" +
      "## 三、股权与实控人线索（股东、母公司、穿透信息——仅有证据内线索）\n" +
      "## 四、舆情与平台口碑（新闻、招聘口碑、小红书/抖音评价摘录）\n" +
      "## 五、求职/合作防骗提示（针对招聘场景的客观提醒）\n" +
      "## 六、核实建议（国家企业信用信息公示系统、裁判文书网、执行信息公开网等官方渠道）；\n" +
      "6) 「小红书站内采集」证据是用户在小红书平台内亲自检索并粘贴的一手内容，可信度高于搜索引擎摘要，舆情部分应优先引用并在文末注明\"来自小红书站内采集\"。";

    const user =
      "【目标公司】" + company + "\n\n" +
      "【结构化工商字段（命中次数与候选值）】\n" + fieldTable + "\n\n" +
      (baike && Object.keys(baike.fields || {}).length ? "【百度百科词条】" + baike.title + "\n" + Object.entries(baike.fields).map(([k, v]) => k + "：" + v).join("\n") + "\n\n" : "") +
      "【多渠道检索证据（含条目标题，可据此识别关联公司）】\n" + sections.join("\n\n").slice(0, 16000);

    const { text, usage } = await ctx.llm.call({
      apiKey: ctx.settings.apiKey,
      model: ctx.settings.model,
      messages: [{ role: "system", content: sys }, { role: "user", content: user }],
      temperature: 0.4
    });
    logger.info("agent.company", "done in", Date.now() - started, "ms, evidence=", uniq.length, "fields=", Object.keys(fields).length);
    return { text, meta: { agent: this.id, agentName: this.name, ms: Date.now() - started, usage, evidenceRows: uniq.length, fields: Object.keys(fields) } };
  }
}

module.exports = { CompanyAgent };