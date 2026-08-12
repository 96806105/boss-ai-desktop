const { BaseAgent } = require("./base");

/**
 * 面试准备 Agent：公司情报（工具检索）+ 简历 → 面试准备卡。
 * 多 Agent 协作示范：内部调用 webSearch 工具收集公司公开情报，再交给 LLM 综合。
 */
class InterviewAgent extends BaseAgent {
  constructor() {
    super({
      id: "interview",
      name: "面试教练",
      role: "面试准备研究与输出",
      description: "研究目标公司与岗位，结合简历生成结构化面试准备卡",
      temperature: 0.5,
      useTools: ["webSearch"]
    });
  }

  buildToolArgs(input) {
    return { company: (input && input.company) || "" };
  }

  buildMessages(input, ctx) {
    const { company, title, salary, resumeText, jdDesc } = input || {};
    const sys = "你是资深面试教练与行业分析师，为求职者生成一份面试准备卡。" +
      "要求：1) 全文必须中文，禁止夹杂任何英文单词或句子（技术名词如 Python、Excel 例外，但需中文语境表述）；" +
      "2) 公司情报优先使用【工具检索到的公开信息】中的事实，其次基于你的知识，不确定的信息标注（待核实），不要编造具体数据；" +
      "3) 高频面试题 6-8 个，每题给出参考回答要点，回答必须基于简历中的真实经历，禁止编造简历没有的经历；" +
      "4) 输出使用 Markdown：## 公司情报 / ## 岗位考察重点 / ## 高频面试题与参考回答 / ## 可以反问的问题 / ## 我的匹配亮点。";
    const user =
      "【公司】" + (company || "未知") +
      "\n【岗位】" + (title || "未知") + (salary ? "（" + salary + "）" : "") +
      "\n【职位描述】" + (jdDesc || "无") +
      "\n\n【我的简历】\n" + (resumeText || "（未提供简历）");
    return [{ role: "system", content: sys }, { role: "user", content: user }];
  }
}

module.exports = { InterviewAgent };