const { BaseAgent } = require("./base");

const STYLES = {
  prof: "专业稳重：语气专业、真诚、简洁有力，不浮夸不套近乎",
  warm: "热情亲和：态度热情积极，体现真诚、有礼貌、有亲和力",
  brief: "简洁高效：回复100字内，直接切入重点"
};

/** AI 痕迹禁用清单（与 greeting 共用同一套） */
const FORBIDDEN = [
  "高度契合", "快速胜任", "能力匹配", "期待与您进一步沟通", "希望能有机会", "很高兴认识你", "期待您的回复", "祝工作顺利",
  "首先", "其次", "最后", "总之", "综上所述", "总而言之", "需要注意的是", "众所周知",
  "贵司", "深知", "赋能", "落地", "沉淀", "抓手", "闭环", "思维模型", "方法论", "底层逻辑", "深耕", "专业素养", "综合素质",
  "殷切", "诚挚", "万分", "深深", "贵公司", "有幸", "不胜荣幸"
];

/** 人话示例：不同对话场景的回复语感（内容替换为简历真实信息） */
const EXAMPLES = [
  "【场景1·对方问经验】对方：您之前有做过这类岗位吗？\n回复：做过，之前在一家 MCN 做了 3 年内容运营，抖音号从 0 做到 10 万粉，选题到剪辑都是自己扛。您这边账号现在是什么阶段？",
  "【场景2·对方问薪资预期】对方：您期望的薪资是多少？\n回复：现在到手 9 左右，希望新的机会能到 11-12，不过也看岗位具体内容，如果平台和方向合适可以再聊。",
  "【场景3·对方约面试】对方：方便的话这周约个时间聊聊？\n回复：可以的，工作日晚上或者周末都方便，您看哪天合适，我把时间空出来。"
];

const THINK_GUIDE =
  "动笔前先在心里过一遍（不要输出思考过程）：\n" +
  "1) 对方这句话背后想问什么？——先抓住他真正的意图，不要只回答字面；\n" +
  "2) 我的回复里哪个信息能让他愿意继续聊下去？——回答里带一个钩子（具体事实或反问）；\n" +
  "3) 这句话我平时会怎么说？——像微信聊天打字，不是写作文。";

const HUMAN_RULES =
  "像真实的人在微信上回消息：\n" +
  "1) 直接回重点，先回答对方问的，再补充一句自己的情况或反问一句；\n" +
  "2) 短句为主，不要排比、不要列点、不要冒号标题；\n" +
  "3) 可以有\"嗯\"\"之前\"\"其实\"\"这边\"\"哈\"\"~\"这类自然的词，别滥用；\n" +
  "4) 数字用口语说法；不要每句都以\"我\"开头；\n" +
  "5) 结尾要么自然收住，要么带反问把话头递回去，不要\"期待您的回复\"这类礼貌句。";

/**
 * 回复 Agent v2：像人一样回消息（few-shot 语感 + 思考前置 + AI 痕迹禁用）
 */
class ReplyAgent extends BaseAgent {
  constructor() {
    super({
      id: "reply",
      name: "回复助手",
      role: "求职聊天应答",
      description: "像真人一样针对对方消息写回复",
      temperature: 0.7
    });
  }

  buildMessages({ jd, history, settings }) {
    const s = settings || {};
    const style = STYLES[s.style] || STYLES.prof;
    const lastSelf = history.filter((h) => h.self).slice(-2);
    const sys =
      "你是求职者本人，正在BOSS直聘上和招聘者微信式聊天。针对对方最新一条消息，像真人一样回复。" +
      "\n\n【人设】你说话直接、不端架子，答完问题会自然带一句反问或补充，让对话能继续。" +
      "所有具体内容必须来自简历真实信息，禁止编造或补充简历没有的细节。" +
      "对方问到的技能如果简历里没有，就直说\"这个我确实还没接触过\"或\"没做过，但愿意学\"，绝不要编造\"会一点\"\"在学\"\"基础操作\"之类的中间状态；" +
      "\n\n【思考前置】" + THINK_GUIDE +
      "\n\n【语气示例（模仿语感，内容换成简历真实信息）】\n" + EXAMPLES.join("\n\n") +
      "\n\n【口语化规则】" + HUMAN_RULES +
      "\n\n【风格】" + style +
      "\n\n【禁用词】" + FORBIDDEN.join("、") + "——全文不得出现任何一个。" +
      "全文必须中文，禁止夹杂英文（技能名词如 Python、Excel 例外）。" +
      "60~150字，只输出回复正文，不要任何前缀、引号或解释。" +
      (s.customPrompt && String(s.customPrompt).trim() ? "\n\n【用户自定义要求（必须严格遵守）】\n" + String(s.customPrompt).trim() : "");
    const user =
      "【岗位信息】\n职位：" + (jd.title || "未知") + "，公司：" + (jd.company || "未知") + "，薪资：" + (jd.salary || "未知") +
      "\n职位描述：\n" + (jd.desc || "无") +
      "\n\n【我的简历】\n" + (s.resumeText || "（未提供简历）") +
      "\n\n【对话记录】（最近" + history.length + "条，最后是我方消息则备注）\n" + history.map((h) => (h.self ? "我：" : "对方：") + h.text).join("\n");
    return [{ role: "system", content: sys }, { role: "user", content: user }];
  }

  async execute(input, ctx) {
    const { jd, history, settings } = input;
    return super.execute({ jd, history, settings }, ctx);
  }
}

module.exports = { ReplyAgent };
