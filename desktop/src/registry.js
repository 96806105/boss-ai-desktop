const { GreetingAgent } = require("./agents/greeting");
const { ReplyAgent } = require("./agents/reply");
const { InterviewAgent } = require("./agents/interview");
const { CompanyAgent } = require("./agents/company");
const { ApplicationAgent } = require("./agents/application");
const { MatchAgent } = require("./agents/match");

/**
 * Agent 注册表：所有专业智能体的唯一入口。
 * 新增智能体：实例化后在此登记即可，编排器与 UI 自动感知。
 */
const registry = new Map();

function register(agent) {
  if (!agent || !agent.id) throw new Error("Agent 缺少 id");
  if (registry.has(agent.id)) throw new Error("Agent 重复注册: " + agent.id);
  registry.set(agent.id, agent);
  return agent;
}

register(new GreetingAgent());
register(new ReplyAgent());
register(new InterviewAgent());
register(new CompanyAgent());
register(new ApplicationAgent());
register(new MatchAgent());

function get(id) {
  return registry.get(id) || null;
}

function list() {
  return Array.from(registry.values()).map((a) => ({
    id: a.id,
    name: a.name,
    role: a.role,
    description: a.description,
    tools: a.useTools || []
  }));
}

module.exports = { registry, get, list, register };