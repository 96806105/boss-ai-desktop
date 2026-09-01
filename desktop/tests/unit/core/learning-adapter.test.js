const fs = require("fs");
const path = require("path");
const { LearningAdapter } = require("../../../src/core/learning-adapter");

describe("LearningAdapter", () => {
  let adapter;
  const testDir = path.join(__dirname, "../../fixtures/learning-test");
  const testFile = path.join(testDir, "learning-data.json");

  beforeEach(() => {
    if (fs.existsSync(testFile)) fs.unlinkSync(testFile);
    adapter = new LearningAdapter(testDir);
  });

  afterEach(() => {
    if (fs.existsSync(testFile)) fs.unlinkSync(testFile);
  });

  describe("recordEvent", () => {
    test("记录 accept 事件", () => {
      adapter.recordEvent("greeting", "accept", { jobName: "Python开发" });
      const stats = adapter.getStats("greeting");
      expect(stats.accept).toBe(1);
      expect(stats.total).toBe(1);
    });

    test("记录多个事件并更新统计", () => {
      adapter.recordEvent("greeting", "accept");
      adapter.recordEvent("greeting", "modify");
      adapter.recordEvent("greeting", "reject");
      const stats = adapter.getStats("greeting");
      expect(stats.accept).toBe(1);
      expect(stats.modify).toBe(1);
      expect(stats.reject).toBe(1);
      expect(stats.total).toBe(3);
    });

    test("数据持久化到文件", () => {
      adapter.recordEvent("greeting", "accept");
      const adapter2 = new LearningAdapter(testDir);
      const stats = adapter2.getStats("greeting");
      expect(stats.accept).toBe(1);
    });
  });

  describe("getStats", () => {
    test("空 agent 返回零值", () => {
      const stats = adapter.getStats("nonexistent");
      expect(stats.total).toBe(0);
      expect(stats.acceptRate).toBe(0);
    });

    test("计算比率", () => {
      adapter.recordEvent("greeting", "accept");
      adapter.recordEvent("greeting", "accept");
      adapter.recordEvent("greeting", "reject");
      const stats = adapter.getStats("greeting");
      expect(stats.acceptRate).toBeCloseTo(2 / 3);
      expect(stats.rejectRate).toBeCloseTo(1 / 3);
    });
  });

  describe("getRecentEvents", () => {
    test("返回最近 N 条事件", () => {
      for (let i = 0; i < 5; i++) {
        adapter.recordEvent("greeting", "accept", { index: i });
      }
      const events = adapter.getRecentEvents("greeting", 3);
      expect(events).toHaveLength(3);
      expect(events[2].index).toBe(4);
    });

    test("空 agent 返回空数组", () => {
      expect(adapter.getRecentEvents("nonexistent")).toEqual([]);
    });
  });

  describe("getRejectionPatterns", () => {
    test("分析拒绝原因", () => {
      adapter.recordEvent("greeting", "reject", { reason: "太正式", example: "您好" });
      adapter.recordEvent("greeting", "reject", { reason: "太正式", example: "尊敬的" });
      adapter.recordEvent("greeting", "reject", { reason: "有AI痕迹", example: "赋能" });
      const patterns = adapter.getRejectionPatterns("greeting");
      expect(patterns.reasons).toHaveLength(2);
      expect(patterns.reasons[0].reason).toBe("太正式");
      expect(patterns.reasons[0].count).toBe(2);
    });

    test("无拒绝数据返回提示", () => {
      const patterns = adapter.getRejectionPatterns("greeting");
      expect(patterns.reasons).toHaveLength(0);
      expect(patterns.suggestion).toBe("暂无拒绝数据");
    });

    test("根据原因给出建议", () => {
      adapter.recordEvent("greeting", "reject", { reason: "有AI痕迹" });
      const patterns = adapter.getRejectionPatterns("greeting");
      expect(patterns.suggestion).toContain("few-shot");
    });
  });

  describe("getAdjustmentStrategy", () => {
    test("数据不足时返回 collecting", () => {
      adapter.recordEvent("greeting", "accept");
      const result = adapter.getAdjustmentStrategy("greeting");
      expect(result.strategy).toBe("collecting");
    });

    test("拒绝率高时返回 aggressive_adjust", () => {
      for (let i = 0; i < 12; i++) {
        adapter.recordEvent("greeting", i < 8 ? "reject" : "accept");
      }
      const result = adapter.getAdjustmentStrategy("greeting");
      expect(result.strategy).toBe("aggressive_adjust");
    });

    test("接受率高时返回 maintain", () => {
      for (let i = 0; i < 12; i++) {
        adapter.recordEvent("greeting", i < 10 ? "accept" : "reject");
      }
      const result = adapter.getAdjustmentStrategy("greeting");
      expect(result.strategy).toBe("maintain");
    });
  });
});
