/**
 * GreetingAgent v6（重构版）：
 * 使用 AgentBase + prompt 模板 + resume-analysis skill
 */
const { AgentBase } = require("./agent-base");
const store = require("../core/store");
const {
  SKILL_WORDS, TECH_TERMS, SOFT_TERMS, EXEC_SUPPORT_TERMS,
  isTechJd, isFreshman, extractJdKeywords, extractJdNeeds, rankResume
} = require("../skills/resume-analysis/index");

const STYLES = {
  prof: "标准礼貌：像BOSS直聘主流打招呼话术——您好+感兴趣开场，简述经验和优势，请参考简历，期待回复。简洁、正式、有礼",
  warm: "热情亲和：有礼貌有亲和力，结尾自然邀请，保持简洁不啰嗦",
  brief: "简洁高效：两三句话讲完，突出最有价值的匹配点，篇幅最短"
};

function recentGreetings(limit = 3) {
  try {
    const list = store.get("bossAiHistory") || [];
    return list.filter((h) => h && h.kind === "greeting" && h.result).slice(0, limit).map((h) => h.result.slice(0, 220));
  } catch (e) {
    return [];
  }
}

function extractVersionTexts(text) {
  const t = String(text || "");
  const re = /【\s*版本\s*[0-9一二三四五六七八九十]+\s*】/g;
  const out = [];
  let last = null;
  let m;
  while ((m = re.exec(t))) {
    if (last) out.push(t.slice(last.end, m.index).trim());
    last = { end: m.index + m[0].length };
  }
  if (last) out.push(t.slice(last.end).trim());
  return out.filter((s) => s.length >= 10);
}

class GreetingAgent extends AgentBase {
  constructor({ learningAdapter } = {}) {
    super({
      id: "greeting",
      name: "招呼语专家",
      role: "求职沟通文案撰写",
      description: "基于职位信息与简历，生成两版像真人说的招呼语",
      temperature: 0.8,
      learningAdapter
    });
  }

  buildSys(settings, hasHighMatch, recent, needs, tech, freshman, execSupport) {
    const s = settings || {};
    const style = STYLES[s.style] || STYLES.prof;

    // 加载基础模板
    let sys = this.renderPrompt("system.md", {
      style,
      forbiddenWords: require("../skills/communication/index").DEFAULT_FORBIDDEN.join("、")
    });

    // 追加条件段落
    const sections = [
      {
        condition: !hasHighMatch,
        content: "\n注意：简历与岗位交集较少时，可以坦然说明没有直接经验，同时亮出兴趣、学习能力和可迁移技能，不编造经历。"
      },
      {
        condition: freshman,
        content: "\n\n【身份策略：应届生】HR 在 BOSS 页面上能看到你的应届生身份，文案里不必再声明\"我是应届生\"。重点阐述实习经历、技能和潜力，用做过的事证明能力，收尾用\"请参考我的简历，期待您的回复！\""
      },
      {
        condition: execSupport,
        content: "\n\n【岗位类型：执行支撑岗（助理/文员/行政类）】这类岗位核心是细心、执行到位、靠谱、能补位。价值主张围绕：做事细致不出错、交代的事有回音。不要讲\"独立带队/操盘项目/战略\"这类话。"
      },
      {
        condition: !tech,
        content: "\n\n【岗位类型判定：非技术岗】全文禁止出现简历里的技术名词和项目技术细节，重点论证通用素质与岗位的匹配：沟通表达、服务意识、耐心、执行力、责任心。"
      },
      {
        condition: !hasHighMatch,
        content: "\n\n【简历与岗位交集较少（策略：坦诚+学习能力）】可以说\"没有直接做过XX方向\"，但要立刻接上兴趣+学得快+可迁移技能。简历与岗位毫无交集时，就讲通用素质+礼貌收尾，不编经历。"
      }
    ];

    sys += this.buildConditionalSections(sections);

    // 用户自定义 prompt
    if (s.customPrompt && String(s.customPrompt).trim()) {
      sys += "\n\n【用户自定义要求（必须严格遵守）】\n" + String(s.customPrompt).trim();
    }

    // 最近已发出的招呼语
    if (recent.length) {
      sys += "\n\n【最近已发出的招呼语（严禁与它们开场方式、结构、句式雷同）】\n" + recent.map((t, i) => (i + 1) + ". " + t).join("\n");
    }

    sys += "\n\n输出2个版本，每个版本以【版本1】【版本2】开头独占一行，两版之间空一行。两版必须从素材、开场句、侧重点、收尾句四个维度明显不同。全文不提问、不反问。";
    return sys;
  }

  buildMessages(input, ctx) {
    const jd = (input && input.jd) || input || {};
    const s = (input && input.settings) || (ctx && ctx.settings) || {};
    const resumeText = store.resolveResume(s);
    const tech = isTechJd(jd);
    const freshman = isFreshman(resumeText);
    const execSupport = !tech && EXEC_SUPPORT_TERMS.some((t) => String(jd.title || "").includes(t) || String(jd.tags || "").includes(t));
    const kw = extractJdKeywords(jd);
    const needs = extractJdNeeds(jd, tech);
    const ranked = rankResume(resumeText, kw.words, needs, tech);
    const recent = recentGreetings(3);

    const user =
      "【岗位信息】\n职位：" + (jd.title || "未知") +
      "\n公司：" + (jd.company || "未知") +
      "\n薪资：" + (jd.salary || "未知") +
      "\n标签：" + (jd.tags || "无") +
      "\n职位描述：\n" + (jd.desc || "无") +
      "\n\n【岗位类型判定】" + (tech ? "技术型岗位" : (execSupport ? "非技术型 · 执行支撑岗" : "非技术型岗位")) +
      "\n\n【候选人身份】" + (freshman ? "应届毕业生" : "有经验候选人") +
      "\n\n【JD 核心需求点 · 逐条提取】" + (needs.length ? "\n" + needs.map((n, i) => (i + 1) + ". " + n).join("\n") : "（无）") +
      "\n\n【JD 关键词 · 词表命中】" + kw.top +
      (ranked.high.length
        ? "\n\n【简历 · 与岗位高度相关的片段】\n" + ranked.high.map((p, i) => "片段" + (i + 1) + "（需求点：" + (p.needHits.length ? p.needHits.join("、") : "—") + "；技能词：" + p.hits.join("、") + "）：" + p.text).join("\n\n") +
          "\n\n【简历 · 其余片段（仅作背景了解）】\n" + (ranked.low.length ? ranked.low.join("\n---\n").slice(0, 2000) : "（无）")
        : "\n\n【简历】\n" + (resumeText ? resumeText.slice(0, 2500) : "（未提供简历）")) +
      "\n\n【最近已发出的招呼语（风格参考，结构不得雷同）】\n" + (recent.length ? recent.join("\n---\n") : "（无历史）") +
      "\n\n（本次写作随机盐：" + Math.random().toString(36).slice(2, 8) + "——仅用于保证多次生成内容不重复）";

    return [{ role: "system", content: this.buildSys(s, ranked.high.length > 0, recent, needs, tech, freshman, execSupport) }, { role: "user", content: user }];
  }

  async execute(input, ctx) {
    const { jd, settings } = input;
    const run = () => super.execute({ jd, settings }, ctx);

    const res = await run();
    const vs = extractVersionTexts(res.text);
    if (vs.length >= 2 && vs[0] === vs[1]) {
      const retry = await run();
      const vs2 = extractVersionTexts(retry.text);
      if (vs2.length < 2 || vs2[0] !== vs2[1]) return retry;
    }
    return res;
  }
}

module.exports = { GreetingAgent, extractVersionTexts };
