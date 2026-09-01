/**
 * ResumeAnalysisSkill - 简历分析器 Skill
 *
 * 从 greeting.js / match.js 抽取的简历分析能力：
 * - 技能关键词提取
 * - JD-简历相关性排序
 * - 快速匹配评分
 */
const { SkillBase } = require("../skill-base");

/** 技能词表（岗位库检索用） */
const SKILL_WORDS = [
  "python", "java", "go", "golang", "c++", "javascript", "前端", "后端", "全栈", "vue", "react", "node", "flutter", "android", "ios", "小程序",
  "算法", "机器学习", "深度学习", "nlp", "大模型", "ai", "数据分析", "sql", "excel", "tableau", "power bi", "etl", "爬虫", "自动化测试", "测试", "运维", "docker", "k8s", "云计算",
  "运营", "新媒体", "短视频", "抖音", "小红书", "直播", "电商", "淘宝", "天猫", "京东", "拼多多", "内容运营", "用户运营", "社群", "增长", "投放", "广告", "seo", "sem", "文案", "策划", "品牌", "公关", "活动",
  "销售", "客服", "商务", "采购", "供应链", "物流", "外贸", "跟单", "报关", "财务", "会计", "审计", "税务", "出纳", "法务", "合规", "hr", "人事", "招聘", "行政", "秘书", "助理",
  "设计", "ui", "ux", "平面设计", "剪辑", "ps", "ae", "pr", "摄影", "拍摄", "配音", "写作", "翻译", "英语", "日语", "韩语", "雅思", "六级", "四级",
  "金融", "保险", "证券", "基金", "医疗", "健康", "教育", "培训", "汽车", "新能源", "半导体", "芯片", "游戏", "快消", "制造", "房地产", "餐饮", "连锁", "旅游", "传媒", "娱乐"
];

/** 技术岗判定词 */
const TECH_TERMS = [
  "python", "java", "javascript", "golang", "c++", "c#", "php", "rust", "go开发",
  "前端", "后端", "全栈", "开发", "研发", "算法", "测试", "运维", "架构", "数据工程",
  "数据分析", "数据挖掘", "机器学习", "深度学习", "大模型", "llm", "ai", "人工智能",
  "智能体", "agent", "接口", "api", "代码", "编程", "程序", "系统开发", "自动化",
  "爬虫", "小程序", "app开发", "linux", "docker", "数据库", "sql", "工程师"
];

/** 通用软技能词 */
const SOFT_TERMS = [
  "沟通", "表达", "服务", "客户", "耐心", "细心", "细致", "责任心", "执行力",
  "团队", "协作", "配合", "学习", "抗压", "主动", "结果", "效率", "流程",
  "跟进", "协调", "认真", "热情", "亲和", "倾听", "逻辑", "复盘", "负责",
  "解决问题", "数据敏感", "多任务", "时间管理", "独立"
];

/** 执行支撑型岗位词 */
const EXEC_SUPPORT_TERMS = ["助理", "文员", "行政", "秘书", "前台", "后勤", "接待", "档案", "内勤", "主管助理", "专员"];

/** 应届生判定 */
function isFreshman(resumeText) {
  return /(202[0-9]\s*届|应届|在读|大三|大四|毕业前)/.test(String(resumeText || ""));
}

/** 从简历提取技能关键词 */
function extractResumeKeywords(resumeText) {
  const t = String(resumeText || "").toLowerCase();
  const found = [];
  const seen = new Set();
  for (const w of SKILL_WORDS) {
    const re = new RegExp(w.replace(/[+.]/g, "\\$&"), "g");
    if (re.test(t) && !seen.has(w)) {
      seen.add(w);
      found.push(w);
    }
  }
  return found.slice(0, 8);
}

/** 判定岗位是否技术型 */
function isTechJd(jd) {
  const text = [jd.title, jd.tags, jd.desc].filter(Boolean).join(" ").toLowerCase();
  return TECH_TERMS.some((t) => text.includes(t));
}

/** 从 JD 提取关键词 */
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

/** 从 JD 提取核心需求点 */
function extractJdNeeds(jd, tech) {
  const JD_REQ_TRIGGERS = ["负责", "熟悉", "掌握", "精通", "要求", "具备", "擅长", "需要", "能够", "独立", "参与", "做过", "搭建", "带团队", "管理", "输出", "制定", "跟进", "分析", "优化", "撰写", "设计", "开发", "运营", "推广", "维护", "支持", "解决", "配合", "主导", "完成"];

  const text = String(jd.desc || "").replace(/\s+/g, " ").trim();
  if (!text) return [];
  const sentences = text
    .split(/[。；;！!？?\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 4 && s.length <= 80);
  const needs = [];
  for (const s of sentences) {
    const hasTrigger = JD_REQ_TRIGGERS.some((t) => s.includes(t));
    const hasSkill = SKILL_WORDS.some((w) => w.length >= 2 && s.includes(w)) ||
      (!tech && SOFT_TERMS.some((w) => w.length >= 2 && s.includes(w)));
    if (hasTrigger || hasSkill) {
      const clean = s.replace(/^[（(【\[]?\d*[）)】\]]?[、.．\s]*/, "").trim();
      if (clean && !needs.includes(clean)) needs.push(clean);
    }
    if (needs.length >= 5) break;
  }
  return needs;
}

/** 简历按空行切段，按 JD 关键词命中打相关度分 */
function rankResume(resumeText, keywords, jdNeeds, tech) {
  const empty = { high: [], low: [] };
  if (!resumeText || !String(resumeText).trim()) return empty;

  const needFrags = (jdNeeds || []).map((need) => {
    return String(need)
      .split(/[,，、:：\s]+/)
      .map((p) => p.trim().replace(/^(?:的|与|和|及|对于|相关|负责|熟悉|掌握|精通|要求|具备|擅长|需要|能够|独立|参与|主导|配合|协助|完成)/, ""))
      .filter((p) => p.length >= 2 && p.length <= 12)
      .slice(0, 3)
      .map((p) => p.toLowerCase());
  }).flat().filter(Boolean);

  const softPool = tech ? [] : SOFT_TERMS;
  const segs = String(resumeText)
    .split(/\n\s*\n/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 8);

  for (const seg of segs) {
    const lower = seg.toLowerCase();
    const hits = (keywords || []).filter((w) => lower.includes(w));
    const needHits = needFrags.filter((f) => lower.includes(f));
    const softHits = softPool.filter((w) => w.length >= 2 && lower.includes(w));
    if (needHits.length || hits.length >= 2 || softHits.length >= 2) {
      empty.high.push({ text: seg.slice(0, 400), hits, needHits, softHits, score: needHits.length * 3 + hits.length + softHits.length });
    } else {
      empty.low.push(seg.slice(0, 300));
    }
  }
  empty.high.sort((a, b) => b.score - a.score);
  return empty;
}

class ResumeAnalysisSkill extends SkillBase {
  constructor(manifest) {
    super(manifest);

    this.registerTool("extractKeywords", async (input) => {
      return extractResumeKeywords(input.resumeText);
    });

    this.registerTool("rankResume", async (input) => {
      return rankResume(input.resumeText, input.keywords, input.jdNeeds, input.tech);
    });

    this.registerTool("quickScore", async (input) => {
      const { jd, resumeText } = input;
      const kw = extractJdKeywords(jd);
      const ranked = rankResume(resumeText, kw.words, extractJdNeeds(jd, isTechJd(jd)), isTechJd(jd));
      return {
        score: ranked.high.length > 0 ? 70 + ranked.high.length * 5 : 30 + ranked.low.length * 2,
        highMatches: ranked.high.length,
        keywords: kw.words
      };
    });
  }
}

module.exports = {
  ResumeAnalysisSkill,
  SKILL_WORDS,
  TECH_TERMS,
  SOFT_TERMS,
  EXEC_SUPPORT_TERMS,
  isFreshman,
  extractResumeKeywords,
  isTechJd,
  extractJdKeywords,
  extractJdNeeds,
  rankResume
};
