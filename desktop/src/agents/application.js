const { BaseAgent } = require("./base");

/**
 * 求职信 Agent：岗位信息 + 简历 → 正式求职信（投递自荐信）。
 * 多 Agent 协作示范：基于简历的真实经历组织论据，杜绝套话与编造。
 */
class ApplicationAgent extends BaseAgent {
  constructor() {
    super({
      id: "application",
      name: "求职信助手",
      role: "正式求职信撰写",
      description: "基于岗位信息与简历，撰写一封正式、有力的求职信（自荐信）",
      temperature: 0.6
    });
  }

  buildMessages(input, { settings } = {}) {
    const { company, title, salary, jdDesc, resumeText, extra } = input || {};
    const sys =
      "你是资深求职顾问，帮求职者撰写一封正式的中文求职信（自荐信）。" +
      "要求：1) 结构：称呼 → 开头表明求职意向（目标公司+岗位）→ 2-3段能力论述 → 简要附加价值 → 结尾致谢并表达面试意愿 + 落款；" +
      "2) 全文必须中文，禁止夹杂任何英文单词或句子（技术名词如 Python、Excel 例外，但需中文语境表述）；" +
      "3) 能力论述必须基于简历中的真实经历（真实项目、系统、奖项、数字），形成\"经历事实→岗位价值\"的论证链，禁止编造简历外的经历，禁止补充简历中不存在的细节（如具体产品品类、具体项目名称、播放量/粉丝数等数据），简历没写的数字一律不得编造，禁止空洞套话（如\"贵公司广阔的发展前景深深吸引了我\"）；" +
      "4) 只选取与目标岗位直接相关的经历作为论述重点；与岗位无关的经历（如跨行业背景）不得作为能力论述段落，最多一句带过或完全省略；" +
      "5) 若简历与该岗位直接相关经历少，就如实写通用能力与学习意愿，不要硬凑；" +
      "6) 全文 600~900 字，语气专业真诚、不卑不亢；" +
      "7) 禁止使用\"期待您的回复\"\"希望能有机会\"\"祝工作顺利\"等万能结尾；" +
      "8) 只输出信件正文，不要任何注释或标题；署名使用\"XXX\"占位。";
    const user =
      "【目标公司】" + (company || "未知") +
      "\n【目标岗位】" + (title || "未知") + (salary ? "（" + salary + "）" : "") +
      "\n【职位描述】\n" + (jdDesc || "无") +
      (extra ? "\n【补充要求】\n" + extra : "") +
      "\n\n【我的简历】\n" + (resumeText || "（未提供简历）");
    return [{ role: "system", content: sys }, { role: "user", content: user }];
  }
}

module.exports = { ApplicationAgent };