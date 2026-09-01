const fs = require("fs");
const path = require("path");
const { AgentBase } = require("../../../src/agents/agent-base");

describe("AgentBase", () => {
  const promptsDir = path.join(__dirname, "../../fixtures/prompts-test");

  class TestAgent extends AgentBase {
    constructor() {
      super({
        id: "test-agent",
        name: "Test Agent",
        role: "test",
        description: "test agent",
        temperature: 0.5,
        promptsDir
      });
    }
  }

  let agent;
  beforeEach(() => {
    // 创建测试 prompt 文件
    const dir = path.join(promptsDir, "test-agent");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "system.md"),
      "你是{{name}}，正在{{action}}。风格：{{style}}"
    );
    agent = new TestAgent();
  });

  afterEach(() => {
    // 清理
    const dir = path.join(promptsDir, "test-agent");
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir);
      for (const f of files) fs.unlinkSync(path.join(dir, f));
      fs.rmdirSync(dir);
    }
  });

  describe("renderPrompt", () => {
    test("加载并渲染 prompt 模板", () => {
      const result = agent.renderPrompt("system.md", {
        name: "测试",
        action: "打招呼",
        style: "轻松"
      });
      expect(result).toBe("你是测试，正在打招呼。风格：轻松");
    });

    test("不存在的模板返回空字符串", () => {
      const result = agent.renderPrompt("nonexistent.md");
      expect(result).toBe("");
    });
  });

  describe("buildConditionalSections", () => {
    test("只返回满足条件的段落", () => {
      const sections = [
        { condition: true, content: "段落1" },
        { condition: false, content: "段落2" },
        { condition: true, content: "段落3" }
      ];
      const result = agent.buildConditionalSections(sections);
      expect(result).toBe("段落1\n\n段落3");
    });

    test("全部不满足返回空字符串", () => {
      const sections = [
        { condition: false, content: "段落1" }
      ];
      const result = agent.buildConditionalSections(sections);
      expect(result).toBe("");
    });

    test("空数组返回空字符串", () => {
      expect(agent.buildConditionalSections([])).toBe("");
    });
  });

  describe("recordEvent", () => {
    test("无 learningAdapter 时不报错", () => {
      expect(() => agent.recordEvent("accept")).not.toThrow();
    });
  });
});
