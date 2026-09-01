/**
 * ReplyAgent v3（重构版）：
 * 使用 AgentBase + prompt 模板
 */
const { AgentBase } = require("./agent-base");
const { resolveResume } = require("../core/store");
const { DEFAULT_FORBIDDEN } = require("../skills/communication/index");

const STYLES = {
  prof: "专业稳重：语气专业、真诚、简洁有力，不浮夸不套近乎",
  warm: "热情亲和：态度热情积极，体现真诚、有礼貌、有亲和力",
  brief: "简洁高效：回复100字内，直接切入重点"
};

const EXAMPLES = [
  "【场景1·对方问经验】对方：您之前有做过这类岗位吗？\n回复：做过，之前在一家 MCN 做了 3 年内容运营，抖音号从 0 做到 10 万粉，选题到剪辑都是自己扛。您这边账号现在是什么阶段？",
  "【场景2·对方问薪资预期】对方：您期望的薪资是多少？\n回复：现在到手 9 左右，希望新的机会能到 11-12，不过也看岗位具体内容，如果平台和方向合适可以再聊。",
  "【场景3·对方约面试】对方：方便的话这周约个时间聊聊？\n回复：可以的，工作日晚上或者周末都方便，您看哪天合适，我把时间空出来。"
];

class ReplyAgent extends AgentBase {
  constructor({ learningAdapter } = {}) {
    super({
      id: "reply",
      name: "回复助手",
      role: "求职聊天应答",
      description: "像真人一样针对对方消息写回复",
      temperature: 0.7,
      learningAdapter
    });
  }

  buildMessages({ jd, history, settings }) {
    const s = settings || {};
    const style = STYLES[s.style] || STYLES.prof;
    const lastSelf = history.filter((h) => h.self).slice(-2);

    const sys = this.renderPrompt("system.md", {
      style,
      forbiddenWords: DEFAULT_FORBIDDEN.join("、")
    }) + (s.customPrompt && String(s.customPrompt).trim()
      ? "\n\n【用户自定义要求（必须严格遵守）】\n" + String(s.customPrompt).trim()
      : "");

    const user =
      "【岗位信息】\n职位：" + (jd.title || "未知") + "，公司：" + (jd.company || "未知") + "，薪资：" + (jd.salary || "未知") +
      "\n职位描述：\n" + (jd.desc || "无") +
      "\n\n【我的简历】\n" + (resolveResume(s) || "（未提供简历）") +
      "\n\n【对话记录】（最近" + history.length + "条，最后是我方消息则备注）\n" + history.map((h) => (h.self ? "我：" : "对方：") + h.text).join("\n");

    return [{ role: "system", content: sys }, { role: "user", content: user }];
  }
}

module.exports = { ReplyAgent };
