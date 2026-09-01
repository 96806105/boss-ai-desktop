/**
 * InterviewAgent v2（重构版）：
 * 使用 AgentBase + prompt 模板
 */
const { AgentBase } = require("./agent-base");
const { resolveResume, get } = require("../core/store");

const Q_KEY = "bossAiInterviewQuestions";

class InterviewAgent extends AgentBase {
  constructor({ learningAdapter } = {}) {
    super({
      id: "interview",
      name: "面试教练",
      role: "面试准备研究与输出",
      description: "研究目标公司与岗位，结合简历生成结构化面试准备卡",
      temperature: 0.5,
      useTools: ["webSearch"],
      learningAdapter
    });
  }

  buildToolArgs(input) {
    return { company: (input && input.company) || "" };
  }

  loadQuestions(limit) {
    return (get(Q_KEY) || [])
      .sort((a, b) => (b.ts || 0) - (a.ts || 0))
      .slice(0, limit || 12)
      .map((it) => {
        let s = "- " + (it.question || "");
        const src = [];
        if (it.company) src.push(it.company);
        if (it.title) src.push(it.title);
        if (src.length) s += "（" + src.join(" · ") + "）";
        if (it.answer) s += " —— 我当时的回答/总结：" + it.answer;
        return s;
      })
      .join("\n");
  }

  buildMessages(input, ctx) {
    const { company, title, salary, resumeText, jdDesc } = input || {};
    const resume = resumeText || resolveResume(ctx && ctx.settings);
    const questions = this.loadQuestions();

    const sys = this.renderPrompt("system.md");
    const user =
      "【公司】" + (company || "未知") +
      "\n【岗位】" + (title || "未知") + (salary ? "（" + salary + "）" : "") +
      "\n【职位描述】" + (jdDesc || "无") +
      "\n\n【我的简历】\n" + (resume || "（未提供简历）") +
      (questions ? "\n\n【我的历史面试问题库】\n" + questions + "\n（以上是用户以往面试中被问到过的问题，请优先覆盖并给出参考回答）" : "");

    return [{ role: "system", content: sys }, { role: "user", content: user }];
  }
}

module.exports = { InterviewAgent };
