const { createStatusHelper } = require("../../../src/utils/status-helpers");

describe("status-helpers", () => {
  describe("createStatusHelper", () => {
    test("返回函数", () => {
      const setStatus = createStatusHelper();
      expect(typeof setStatus).toBe("function");
    });

    test("创建带前缀的状态函数", () => {
      const setCoStatus = createStatusHelper("co");
      expect(typeof setCoStatus).toBe("function");
    });

    test("设置文本和状态", () => {
      const mockEl = { textContent: "", className: "" };
      const setStatus = createStatusHelper("");
      setStatus("loading", false, mockEl);
      expect(mockEl.textContent).toBe("loading");
      expect(mockEl.className).toContain("busy");
    });

    test("设置错误状态", () => {
      const mockEl = { textContent: "", className: "" };
      const setStatus = createStatusHelper("");
      setStatus("error occurred", true, mockEl);
      expect(mockEl.textContent).toBe("error occurred");
      expect(mockEl.className).toContain("err");
    });

    test("清空状态", () => {
      const mockEl = { textContent: "old", className: "status busy" };
      const setStatus = createStatusHelper("");
      setStatus("", false, mockEl);
      expect(mockEl.textContent).toBe("");
    });
  });
});
