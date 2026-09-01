const { ReplyAgent } = require("../../../src/agents/reply");

describe("ReplyAgent", () => {
  describe("constructor", () => {
    test("创建实例", () => {
      const agent = new ReplyAgent();
      expect(agent.id).toBe("reply");
      expect(agent.name).toBe("回复助手");
    });
  });

  describe("buildMessages", () => {
    test("构建消息", () => {
      const agent = new ReplyAgent();
      const msgs = agent.buildMessages({
        jd: { title: "Python开发", company: "某公司", salary: "15K" },
        history: [
          { text: "你好", self: false },
          { text: "您好", self: true }
        ],
        settings: {}
      });
      expect(msgs).toHaveLength(2);
      expect(msgs[0].role).toBe("system");
      expect(msgs[1].role).toBe("user");
      expect(msgs[1].content).toContain("Python开发");
    });
  });
});
