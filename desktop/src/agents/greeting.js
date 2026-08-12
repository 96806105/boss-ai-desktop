const { BaseAgent } = require("./base");
const store = require("../core/store");
const { SKILL_WORDS } = require("../core/tools");

const STYLES = {
  prof: "专业稳重：语气专业、真诚、简洁有力，不浮夸不套近乎，突出能力匹配",
  warm: "热情亲和：态度热情积极，体现真诚、有礼貌、有亲和力，结尾带自然邀请",
  brief: "简洁高效：篇幅短小精悍（招呼语60字内），直接切入重点"
};

/** 从 JD（title+tags+desc）提取关键词：技能词表命中 + 词频 */
function extractJdKeywords(jd) {
  const text = [jd.title, jd.tags, jd.desc].filter(Boolean).join(" ").toLowerCase();
  const freq = {};
  for (const w of SKILL_WORDS) {
    const re = new RegExp(w.replace(/[+.]/g, "\\$&"), "g");
    let n = 0;
    while (re.exec(text)) n++;
    if (n > 0) freq[w] = n;
  }
  const words = Object.keys(freq).sort((a, b) => freq[b] - freq[a]);
  return {
    words,
    top: words.slice(0, 6).join("、") || (words.length ? words.join("、") : "（无法提取，依据职位名称判断）")
  };
}

/** 简历按空行切段，按 JD 关键词命中打相关度分，返回高/低相关片段 */
function rankResume(resumeText, keywords) {
  const empty = { high: [], low: [] };
  if (!resumeText || !String(resumeText).trim()) return empty;
  const segs = String(resumeText)
    .split(/\n\s*\n/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 8);
  for (const seg of segs) {
    const hits = keywords.filter((w) => seg.toLowerCase().includes(w));
    if (hits.length) empty.high.push({ text: seg.slice(0, 400), hits, score: hits.length });
    else empty.low.push(seg.slice(0, 300));
  }
  empty.high.sort((a, b) => b.score - a.score);
  return empty;
}

/** 最近发出的招呼语（防结构雷同） */
function recentGreetings(limit = 3) {
  try {
    const list = store.get("bossAiHistory") || [];
    return list.filter((h) => h && h.kind === "greeting" && h.result).slice(0, limit).map((h) => h.result.slice(0, 220));
  } catch (e) {
    return [];
  }
}

const NO_GO_START = "您好，我是\\s*(?:.+?)(?:的同学|的朋友)\\s*$";

/** AI 痕迹禁用清单：职场黑话 / AI 连接词 / 万能敬语 / 空洞套话 */
const FORBIDDEN = [
  "高度契合", "快速胜任", "能力匹配", "期待与您进一步沟通", "希望能有机会", "很高兴认识你", "期待您的回复", "祝工作顺利",
  "首先", "其次", "最后", "总之", "综上所述", "总而言之", "需要注意的是", "众所周知",
  "贵司", "深知", "赋能", "落地", "沉淀", "抓手", "闭环", "思维模型", "方法论", "底层逻辑", "深耕", "专业素养", "综合素质",
  "殷切", "诚挚", "万分", "深深", "贵公司", "有幸", "不胜荣幸"
];

/** 人话示例（few-shot）：只锚定语气与节奏，内容必须替换为简历真实信息 */
const EXAMPLES_HIGH = [
  "【示例A·直接亮牌】您好，我上份工作就是做抖音运营的，把一个号从 0 做到 10 万粉，选题、剪辑、发布全自己来。看到这个岗位要求独立起号，和我的经历正好对上，想和您聊聊。",
  "【示例B·提问切入】您好，看到贵司在招短视频运营，我做过 3 年这个方向，从 0 起号到 10 万粉。想问下您这边账号现在是主打人设还是带货？想先了解下方向再跟您细聊。",
  "【示例C·共鸣型】您好，我做过 3 年内容运营，特别理解起号前期没人看的时候有多熬人。我这边有一套从选题到剪辑的完整打法，把号做到过 10 万粉。看到贵司的岗位描述，感觉能帮上忙，想聊两句。"
];

const EXAMPLES_LOW = [
  "【示例·低匹配诚实型】您好，我目前在做会计，看到贵司招短视频运营，我没有直接做过这个方向，但对内容行业很有兴趣，Excel 数据这块比较熟，想了解下这个岗位对新人有什么要求？",
  "【示例·低匹配提问型】您好，看到贵司的短视频运营岗位，我上份工作是财务方向的，没直接做过运营。如果愿意给转行的机会，我学习能力还不错，想先了解下团队现在最需要补哪块？"
];

const THINK_GUIDE =
  "动笔前先在心里过一遍（不要输出思考过程）：\n" +
  "1) 对面 HR 一天要看几十条招呼语，他为什么要点开我的？——因为第一条提到的事和他 JD 里写的需求完全对得上；\n" +
  "2) 我简历里哪段经历对这个岗位最值钱？——只有一个最值钱的点，不要平均用力；\n" +
  "3) 我怎么开口能让人想回？——直接说事，别铺垫，别自我介绍开场。";

/** 口语化规则：让输出像真人打字而非公文 */
const HUMAN_RULES =
  "写作时像一个真实的求职者在手机打字：\n" +
  "1) 短句为主，一句说完就说下一句，不要凑排比、不要对称结构；\n" +
  "2) 可以有\"其实\"\"之前\"\"这边\"\"哈\"\"~\"\"想请教下\"这类自然的词，但别滥用；\n" +
  "3) 不要用冒号标题、不要分段列点、不要加粗、不要完美对齐；\n" +
  "4) 数字用口语说法（\"10 万粉\"而不是\"粉丝数达10万余人\"）；\n" +
  "5) 不要每句话都以\"我\"开头，句子长短错落；\n" +
  "6) 结尾要么自然收住，要么带一个具体的问题或邀请，不要加\"期待您的回复\"这类礼貌句。";

/**
 * 招呼语 Agent v4：
 * 相关性工程化（v3 保留）+ few-shot 人话示例 + 人设 + 思考前置 + AI 痕迹禁用
 */
class GreetingAgent extends BaseAgent {
  constructor() {
    super({
      id: "greeting",
      name: "招呼语专家",
      role: "求职沟通文案撰写",
      description: "基于职位信息与简历，生成两版像真人说的招呼语",
      temperature: 0.8
    });
  }

  buildSys(settings, hasHighMatch, recent) {
    const s = settings || {};
    const style = STYLES[s.style] || STYLES.prof;
    const examples = (hasHighMatch ? EXAMPLES_HIGH : EXAMPLES_LOW).join("\n\n");

    let sys =
      "你是求职者本人（不是求职顾问），正在BOSS直聘上主动联系招聘者。" +
      "你的目标：让HR读完第一条就产生\"这人可以聊聊\"的念头。" +
      "\n\n【人设】你是一个真实的求职者：说话直接、不端架子，用词口语化，知道自己最值钱的一段经历是什么。" +
      "所有具体内容必须来自【简历·高相关片段】，禁止编造简历没有的信息（含具体数字、项目、经历）。" +
      (hasHighMatch ? "" : "\n注意：简历与岗位没有直接交集时，坦白说明自己没做过，不编造经历，也不要说\"会一点\"\"了解过\"这类简历里没有的中间状态；可强调真实可迁移的能力并提一个具体问题。") +
      "\n\n【思考前置】" + THINK_GUIDE +
      "\n\n【语气示例（模仿这些示例的语感，但内容必须换成简历里的真实信息）】\n" + examples +
      "\n\n【口语化规则】" + HUMAN_RULES +
      "\n\n【风格】" + style +
      "\n\n【禁用词】" + FORBIDDEN.join("、") + "——全文不得出现任何一个。" +
      "全文必须中文，禁止夹杂英文单词或句子（技能名词如 Python、Excel 例外，需中文语境）。";

    if (s.customPrompt && String(s.customPrompt).trim()) {
      sys += "\n\n【用户自定义要求（必须严格遵守）】\n" + String(s.customPrompt).trim();
    }
    if (recent.length) {
      sys += "\n\n【最近已发出的招呼语（严禁与它们开场方式、结构、句式雷同）】\n" + recent.map((t, i) => (i + 1) + ". " + t).join("\n");
    }
    sys += "\n\n输出2个版本，每个版本以【版本1】【版本2】开头独占一行，两版之间空一行。两版的角度、开场、结尾必须明显不同。";
    return sys;
  }

  buildMessages(input, ctx) {
    const jd = (input && input.jd) || input || {};
    const s = (input && input.settings) || (ctx && ctx.settings) || {};
    const resumeText = s.resumeText || "";
    const kw = extractJdKeywords(jd);
    const ranked = rankResume(resumeText, kw.words);
    const recent = recentGreetings(3);

    const user =
      "【岗位信息】\n职位：" + (jd.title || "未知") +
      "\n公司：" + (jd.company || "未知") +
      "\n薪资：" + (jd.salary || "未知") +
      "\n标签：" + (jd.tags || "无") +
      "\n职位描述：\n" + (jd.desc || "无") +
      "\n\n【JD 核心需求 · 按关键词提取】" + kw.top +
      (ranked.high.length
        ? "\n\n【简历 · 与岗位高度相关的片段（素材只能从这里选取）】\n" + ranked.high.map((p, i) => "片段" + (i + 1) + "（命中：" + p.hits.join("、") + "）：" + p.text).join("\n\n") +
          "\n\n【简历 · 其余片段（仅作背景了解，写招呼语时禁止引用）】\n" + (ranked.low.length ? ranked.low.join("\n---\n").slice(0, 2000) : "（无）")
        : "\n\n【简历】\n" + (resumeText ? resumeText.slice(0, 2500) : "（未提供简历）")) +
      "\n\n【最近已发出的招呼语（风格参考，结构不得雷同）】\n" + (recent.length ? recent.join("\n---\n") : "（无历史）") +
      "\n\n（本次写作随机盐：" + Math.random().toString(36).slice(2, 8) + "——仅用于保证多次生成内容不重复，无需在文案中体现）";

    return [{ role: "system", content: this.buildSys(s, ranked.high.length > 0, recent) }, { role: "user", content: user }];
  }

  async execute(input, ctx) {
    const { jd, settings } = input;
    return super.execute({ jd, settings }, ctx);
  }
}

module.exports = { GreetingAgent, extractJdKeywords, rankResume };