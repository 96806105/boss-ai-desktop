const { BaseAgent } = require("./base");

/**
 * 岗位匹配 Agent：像资深招聘顾问一样"动脑"匹配。
 * 不是关键词擦边匹配，而是逐个岗位思考：
 *   这个岗位真正的核心要求是什么？我的经历能否实质支撑？差距能否接受？
 * 输出结构化打分（0-100）+ 匹配点 + 缺口 + 一句话理由。
 */
class MatchAgent extends BaseAgent {
  constructor() {
    super({
      id: "match",
      name: "岗位匹配师",
      role: "岗位智能匹配",
      description: "基于简历与岗位列表深度匹配打分，识别值得投递的岗位",
      temperature: 0.3,
      model: "deepseek-chat"
    });
  }

  buildMessages(input, ctx) {
    const { resumeText, jobs, extra } = input || {};
    const list = Array.isArray(jobs) ? jobs : [];
    const extraText = String(extra || "").trim();
    const sys =
      "你是资深招聘顾问，帮求职者判断候选岗位值不值得投。你不做关键词匹配，而是像人脑一样逐个岗位思考。" +
      "\n\n【对每个岗位，先在心里过一遍（不输出思考过程）】" +
      "\n1) 这个岗位真正的核心要求是什么？——只提炼不超过 3 条真正决定成败的要求（如：独立剪辑能力、从0起号经验、行业资源），不要把 JD 里每条都列上；" +
      "\n2) 求职者的简历里，哪段经历能实质证明这个要求？——必须能对应上具体的项目、数字、成果才算数；" +
      "\n3) 差距在哪？这个差距能不能通过短期学习或迁移补上？" +
      "\n\n【用户补充要求（优先级最高，与简历冲突时以补充要求为准）】" +
      "\n- 用户可能会补充简历之外的信息（如意向城市、期望薪资、能否加班出差、排斥的岗位类型等）。这些是用户当面的真实意愿，必须严格生效；" +
      "\n- 如果补充了意向城市/地点，岗位地点不含该城市的直接扣分（除非用户写\"可接受\"）；" +
      "\n- 如果补充了期望薪资，薪资明显低于期望的要在理由中明确提醒，并相应降分；" +
      "\n- 如果补充了其他硬性条件（如不接受销售、只考虑双休），违反的岗位直接打 0-20 分并在理由中说明。" +
      "\n\n【打分规则（0-100）】" +
      "\n- 75-100 强推：核心要求都能用简历经历实质支撑（不是只沾边），且不违反任何用户补充要求；" +
      "\n- 60-74 可投：核心要求部分支撑，或经历可迁移、差距可补，用户补充要求基本满足；" +
      "\n- 40-59 勉强：只有关键词重合但经历无法实质支撑，或核心要求明显缺失；" +
      "\n- 0-39 不推荐：核心要求与经历完全不相关，或违反用户补充的硬性条件。" +
      "\n\n【反擦边铁律】" +
      "\n- 禁止\"岗位标题和简历都出现某个词就给高分\"；关键词重合 ≠ 能力匹配；" +
      "\n- 打分必须落在具体经历上：说不出\"哪段经历、什么成果能支撑\"的，一律不超过 60 分；" +
      "\n- 简历中没有的技能，岗位要求再高也要如实算作缺口，不得默认\"学习能力强\"能抵消；" +
      "\n- 薪资明显低于简历期望时要在理由中提醒，但薪资不作为打分的唯一依据。" +
      "\n\n【输出】" +
      "\n只输出一个 JSON 对象（不要 markdown 代码块，不要任何其他文字）：" +
      '\n{"jobs":[{"id":"岗位id","title":"岗位名","company":"公司","score":数字,"level":"strong|ok|low","reason":"一句话口语化理由，30字内","matchPoints":["匹配点1","匹配点2"],"gaps":["缺口1","缺口2"]}]}' +
      "\nlevel 对应：strong=75-100，ok=60-74，low=0-59。reason 像真人顾问说的话，不要\"高度契合\"\"综合能力较强\"这类套话。";
    const user =
      "【我的简历（基本信息+项目经验）】\n" + (resumeText || "（未提供简历）") +
      (extraText ? "\n\n【我的补充要求（优先于简历执行）】\n" + extraText : "") +
      "\n\n【候选岗位列表】\n" + list.map((j, i) =>
        (i + 1) + ". [id:" + (j.id || "") + "] " + (j.title || "未知") + " | " + (j.company || "未知") + " | " + (j.salary || "薪资未知") +
        (j.location ? " | 地点：" + j.location : "") +
        (j.tags ? " | 标签：" + j.tags : "")
      ).join("\n") +
      "\n\n请按上述规则逐个思考并打分，输出 JSON。";
    return [{ role: "system", content: sys }, { role: "user", content: user }];
  }

  parseMatched(text) {
    if (!text) return null;
    let raw = String(text);
    const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) raw = fence[1];
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      const obj = JSON.parse(raw.slice(start, end + 1));
      const jobs = Array.isArray(obj.jobs) ? obj.jobs : [];
      if (!jobs.length) return null;
      return jobs.map((j) => ({
        id: String(j.id || ""),
        title: String(j.title || ""),
        company: String(j.company || ""),
        score: Math.max(0, Math.min(100, Number(j.score) || 0)),
        level: j.level === "ok" ? "ok" : j.level === "low" ? "low" : "strong",
        reason: String(j.reason || ""),
        matchPoints: Array.isArray(j.matchPoints) ? j.matchPoints.slice(0, 3) : [],
        gaps: Array.isArray(j.gaps) ? j.gaps.slice(0, 3) : []
      }));
    } catch (e) {
      return null;
    }
  }

  async execute(input, ctx) {
    const res = await super.execute(input, ctx);
    const matched = this.parseMatched(res.text) || [];
    const byId = new Map();
    for (const j of (input && input.jobs) || []) {
      if (j.id) byId.set(String(j.id), j.href || "");
    }
    for (const m of matched) {
      m.href = byId.get(String(m.id)) || "";
    }
    return { text: res.text, matched, meta: { agent: this.id, agentName: this.name, ...res.meta } };
  }
}

module.exports = { MatchAgent };
