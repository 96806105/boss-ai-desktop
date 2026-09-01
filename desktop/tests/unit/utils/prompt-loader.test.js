const fs = require("fs");
const path = require("path");
const { PromptLoader } = require("../../../src/utils/prompt-loader");

describe("PromptLoader", () => {
  const promptsDir = path.join(__dirname, "../../fixtures/prompts-test");
  let loader;

  beforeEach(() => {
    // 创建测试 prompt 文件
    const dir = path.join(promptsDir, "test-agent");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "system.md"),
      "你是{{name}}，正在{{action}}。风格：{{style}}"
    );
    fs.writeFileSync(path.join(dir, "rules.md"), "规则内容：\n1. 规则一\n2. 规则二");
    loader = new PromptLoader(promptsDir);
  });

  afterEach(() => {
    // 清理测试文件
    const dir = path.join(promptsDir, "test-agent");
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir);
      for (const f of files) {
        fs.unlinkSync(path.join(dir, f));
      }
      fs.rmdirSync(dir);
    }
  });

  describe("load", () => {
    test("加载 prompt 文件", () => {
      const content = loader.load("test-agent", "system.md");
      expect(content).toContain("{{name}}");
      expect(content).toContain("{{action}}");
    });

    test("加载不存在的文件返回空字符串", () => {
      const content = loader.load("test-agent", "nonexistent.md");
      expect(content).toBe("");
    });

    test("结果被缓存", () => {
      const content1 = loader.load("test-agent", "system.md");
      // 修改文件后，缓存的应该还是旧内容
      fs.writeFileSync(
        path.join(promptsDir, "test-agent", "system.md"),
        "新内容"
      );
      const content2 = loader.load("test-agent", "system.md");
      expect(content1).toBe(content2);
    });
  });

  describe("render", () => {
    test("替换模板变量", () => {
      const result = loader.render("test-agent", "system.md", {
        name: "求职者",
        action: "打招呼",
        style: "轻松自然"
      });
      expect(result).toBe("你是求职者，正在打招呼。风格：轻松自然");
    });

    test("替换多个同名变量", () => {
      fs.writeFileSync(
        path.join(promptsDir, "test-agent", "multi.md"),
        "{{name}}和{{name}}是好朋友"
      );
      const result = loader.render("test-agent", "multi.md", { name: "小明" });
      expect(result).toBe("小明和小明是好朋友");
    });
  });

  describe("clearCache", () => {
    test("清除缓存后重新加载文件", () => {
      loader.load("test-agent", "system.md");
      loader.clearCache();
      fs.writeFileSync(
        path.join(promptsDir, "test-agent", "system.md"),
        "新内容"
      );
      const content = loader.load("test-agent", "system.md");
      expect(content).toBe("新内容");
    });
  });

  describe("listFiles", () => {
    test("列出 agent 的所有 prompt 文件", () => {
      const files = loader.listFiles("test-agent");
      expect(files).toContain("system.md");
      expect(files).toContain("rules.md");
    });

    test("空 agent 返回空数组", () => {
      const files = loader.listFiles("nonexistent");
      expect(files).toEqual([]);
    });
  });
});
