/**
 * CommunicationSkill - 人话写作器 Skill
 *
 * 提供像真人一样写作的能力，包括：
 * - 招呼语生成
 * - 回复生成
 * - 求职信生成
 *
 * 核心技术：
 * - few-shot 语感锚定
 * - AI 痕迹禁用词检查
 * - 相关性工程化（简历按 JD 切片选材）
 */
const { SkillBase } = require("../skill-base");
const logger = require("../../core/logger");

/** AI 痕迹禁用清单 */
const DEFAULT_FORBIDDEN = [
  "高度契合", "快速胜任", "能力匹配", "期待与您进一步沟通", "希望能有机会", "祝工作顺利",
  "首先", "其次", "最后", "总之", "综上所述", "总而言之", "需要注意的是", "众所周知",
  "深知", "赋能", "落地", "沉淀", "抓手", "闭环", "思维模型", "方法论", "底层逻辑", "深耕", "专业素养", "综合素质",
  "撑底", "背书", "对得上", "完全对口", "匹配度高", "正是我想要的", "契合", "印证", "磨炼", "沉淀了", "沉淀出",
  "产出", "多线程", "颗粒", "交付"
];

/** 检查文本是否包含 AI 痕迹 */
function checkAiTraces(text, forbiddenWords = DEFAULT_FORBIDDEN) {
  if (!text) return [];
  const found = [];
  for (const word of forbiddenWords) {
    if (text.includes(word)) {
      found.push(word);
    }
  }
  return found;
}

/** 移除 AI 痕迹（标记而非删除，供用户参考） */
function markAiTraces(text, forbiddenWords = DEFAULT_FORBIDDEN) {
  if (!text) return text;
  // 按长度降序排列，避免短词匹配到长词内部（如"契合"匹配到"高度契合"内部）
  const sorted = [...forbiddenWords].sort((a, b) => b.length - a.length);
  let marked = text;
  for (const word of sorted) {
    if (!marked.includes(word)) continue;
    // 如果 word 已经被包裹在 【AI痕迹:...】 标记中，跳过
    const markerRe = new RegExp(`【AI痕迹:[^】]*${word.replace(/[+*.?^${}()|[\]\\]/g, "\\$&")}[^】]*】`);
    if (markerRe.test(marked)) continue;
    marked = marked.replace(new RegExp(word, "g"), `【AI痕迹:${word}】`);
  }
  return marked;
}

class CommunicationSkill extends SkillBase {
  constructor(manifest) {
    super(manifest);

    this.registerTool("checkAiTraces", async (input) => {
      return checkAiTraces(input.text, input.forbiddenWords);
    });

    this.registerTool("markAiTraces", async (input) => {
      return markAiTraces(input.text, input.forbiddenWords);
    });

    this.registerTool("generateGreeting", async (input, ctx) => {
      // 实际生成由 Agent 调用 LLM 完成
      // 这里只提供工具能力
      return { ready: true, action: "generateGreeting" };
    });

    this.registerTool("generateReply", async (input, ctx) => {
      return { ready: true, action: "generateReply" };
    });

    this.registerTool("generateLetter", async (input, ctx) => {
      return { ready: true, action: "generateLetter" };
    });
  }
}

module.exports = { CommunicationSkill, checkAiTraces, markAiTraces, DEFAULT_FORBIDDEN };
