const { escHtml, truncate, isVisible, pickText, pickTextList } = require("../../../src/utils/dom-helpers");

describe("dom-helpers", () => {
  describe("escHtml", () => {
    test("转义 HTML 特殊字符", () => {
      expect(escHtml("<script>alert('xss')</script>")).toBe("&lt;script&gt;alert(&#39;xss&#39;)&lt;/script&gt;");
    });

    test("转义 & 和引号", () => {
      expect(escHtml('a & b "c"')).toBe("a &amp; b &quot;c&quot;");
    });

    test("处理空值", () => {
      expect(escHtml("")).toBe("");
      expect(escHtml(null)).toBe("");
      expect(escHtml(undefined)).toBe("");
    });

    test("非字符串输入转为字符串", () => {
      expect(escHtml(123)).toBe("123");
      expect(escHtml(true)).toBe("true");
    });
  });

  describe("truncate", () => {
    test("短文本不截断", () => {
      expect(truncate("hello", 10)).toBe("hello");
    });

    test("长文本截断并追加省略号", () => {
      expect(truncate("hello world", 5)).toBe("hello…");
    });

    test("处理空值", () => {
      expect(truncate("", 10)).toBe("");
      expect(truncate(null, 10)).toBe("");
    });

    test("刚好等于长度不截断", () => {
      expect(truncate("12345", 5)).toBe("12345");
    });
  });

  describe("isVisible", () => {
    test("无元素返回 false", () => {
      expect(isVisible(null)).toBe(false);
      expect(isVisible(undefined)).toBe(false);
    });
  });

  describe("pickText", () => {
    test("从匹配的选择器返回文本", () => {
      const mockRoot = {
        querySelector: (sel) => {
          if (sel === ".target") return { textContent: "  hello  " };
          return null;
        }
      };
      expect(pickText([".other", ".target"], mockRoot)).toBe("hello");
    });

    test("无匹配返回空字符串", () => {
      const mockRoot = { querySelector: () => null };
      expect(pickText([".a", ".b"], mockRoot)).toBe("");
    });

    test("去除多余空白和零宽字符", () => {
      const mockRoot = {
        querySelector: () => ({ textContent: "hello\u200b  world" })
      };
      expect(pickText([".a"], mockRoot)).toBe("hello world");
    });
  });

  describe("pickTextList", () => {
    test("返回匹配元素的文本数组", () => {
      const mockRoot = {
        querySelectorAll: () => [
          { textContent: "item1" },
          { textContent: "item2" }
        ]
      };
      expect(pickTextList([".item"], mockRoot)).toEqual(["item1", "item2"]);
    });

    test("无匹配返回空数组", () => {
      const mockRoot = { querySelectorAll: () => [] };
      expect(pickTextList([".item"], mockRoot)).toEqual([]);
    });
  });
});
