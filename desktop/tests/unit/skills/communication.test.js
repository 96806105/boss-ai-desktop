const { checkAiTraces, markAiTraces, DEFAULT_FORBIDDEN } = require("../../../src/skills/communication/index");

describe("communication skill", () => {
  describe("checkAiTraces", () => {
    test("检测到 AI 痕迹词汇", () => {
      const text = "我非常擅长这个领域，具有高度契合的能力和赋能思维";
      const found = checkAiTraces(text);
      expect(found).toContain("高度契合");
      expect(found).toContain("赋能");
    });

    test("无 AI 痕迹返回空数组", () => {
      const text = "我做过3年Python开发，熟悉数据分析";
      const found = checkAiTraces(text);
      expect(found).toHaveLength(0);
    });

    test("使用自定义禁用词", () => {
      const text = "这是测试文本";
      const found = checkAiTraces(text, ["测试"]);
      expect(found).toContain("测试");
    });

    test("处理空文本", () => {
      expect(checkAiTraces("")).toEqual([]);
      expect(checkAiTraces(null)).toEqual([]);
    });
  });

  describe("markAiTraces", () => {
    test("标记 AI 痕迹词汇", () => {
      const text = "我具有高度契合的能力";
      const marked = markAiTraces(text);
      expect(marked).toContain("【AI痕迹:高度契合】");
    });

    test("多个痕迹全部标记", () => {
      const text = "赋能思维，闭环管理，方法论落地";
      const marked = markAiTraces(text);
      expect(marked).toContain("【AI痕迹:赋能】");
      expect(marked).toContain("【AI痕迹:闭环】");
      expect(marked).toContain("【AI痕迹:方法论】");
      expect(marked).toContain("【AI痕迹:落地】");
    });

    test("无痕迹原样返回", () => {
      const text = "我做过3年开发";
      expect(markAiTraces(text)).toBe(text);
    });
  });

  describe("DEFAULT_FORBIDDEN", () => {
    test("包含常见 AI 痕迹词", () => {
      expect(DEFAULT_FORBIDDEN).toContain("赋能");
      expect(DEFAULT_FORBIDDEN).toContain("闭环");
      expect(DEFAULT_FORBIDDEN).toContain("方法论");
      expect(DEFAULT_FORBIDDEN).toContain("底层逻辑");
    });

    test("数量合理", () => {
      expect(DEFAULT_FORBIDDEN.length).toBeGreaterThan(20);
    });
  });
});
