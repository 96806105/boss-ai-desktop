const { GreetingAgent, extractVersionTexts } = require("../../../src/agents/greeting");

describe("GreetingAgent", () => {
  describe("extractVersionTexts", () => {
    test("提取【版本N】标记的文本", () => {
      const text = "【版本1】您好，我对您发布的Python开发岗位感兴趣，有3年经验。\n\n【版本2】看到您发布的Python开发岗位，我做过后端开发，熟悉相关技术。";
      const versions = extractVersionTexts(text);
      expect(versions).toHaveLength(2);
      expect(versions[0]).toContain("感兴趣");
      expect(versions[1]).toContain("看到");
    });

    test("处理空文本", () => {
      expect(extractVersionTexts("")).toEqual([]);
      expect(extractVersionTexts(null)).toEqual([]);
    });

    test("无版本标记返回空数组", () => {
      expect(extractVersionTexts("普通文本没有版本标记")).toEqual([]);
    });
  });

  describe("constructor", () => {
    test("创建实例", () => {
      const agent = new GreetingAgent();
      expect(agent.id).toBe("greeting");
      expect(agent.name).toBe("招呼语专家");
    });

    test("支持 learningAdapter", () => {
      const mockAdapter = { recordEvent: jest.fn() };
      const agent = new GreetingAgent({ learningAdapter: mockAdapter });
      expect(agent.learningAdapter).toBe(mockAdapter);
    });
  });

  describe("buildSys", () => {
    test("生成系统 prompt", () => {
      const agent = new GreetingAgent();
      const sys = agent.buildSys({}, true, [], ["负责数据分析"], true, false, false);
      expect(sys).toContain("求职者本人");
      expect(sys).toContain("版本1");
      expect(sys).toContain("版本2");
    });
  });
});
