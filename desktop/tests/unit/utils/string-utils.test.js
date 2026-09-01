const { cleanText, normFieldVal, stripTags } = require("../../../src/utils/string-utils");

describe("string-utils", () => {
  describe("cleanText", () => {
    test("清理乱码字符", () => {
      expect(cleanText("hello\uFFFDworld")).toBe("helloworld");
    });

    test("清理换行符", () => {
      expect(cleanText("hello\n\rworld")).toBe("hello world");
    });

    test("合并多余空白", () => {
      expect(cleanText("  hello   world  ")).toBe("hello world");
    });

    test("处理空值", () => {
      expect(cleanText("")).toBe("");
      expect(cleanText(null)).toBe("");
    });
  });

  describe("normFieldVal", () => {
    test("规范化的金额文本", () => {
      expect(normFieldVal("1000万元")).toBe("1000万");
      expect(normFieldVal("1000万人民币")).toBe("1000万");
      expect(normFieldVal("1000元")).toBe("1000元"); // 纯"元"不处理，只有万/亿才去后缀
    });

    test("规范化的亿级金额", () => {
      expect(normFieldVal("1.2亿元")).toBe("1.2亿");
      expect(normFieldVal("1.2亿人民币")).toBe("1.2亿");
    });

    test("处理空值", () => {
      expect(normFieldVal("")).toBe("");
      expect(normFieldVal(null)).toBe("");
    });

    test("无后缀原样返回", () => {
      expect(normFieldVal("1000万")).toBe("1000万");
    });
  });

  describe("stripTags", () => {
    test("剥离 HTML 标签", () => {
      expect(stripTags("<p>hello</p>")).toBe("hello");
    });

    test("剥离 script 和 style", () => {
      expect(stripTags("text<script>alert('xss')</script>more")).toBe("text more");
      expect(stripTags("text<style>.a{}</style>more")).toBe("text more");
    });

    test("转义 HTML 实体", () => {
      expect(stripTags("a&amp;b&lt;c&gt;d")).toBe("a&b<c>d");
    });

    test("合并空白", () => {
      expect(stripTags("<p>  hello  </p>")).toBe("hello");
    });

    test("处理空值", () => {
      expect(stripTags("")).toBe("");
      expect(stripTags(null)).toBe("");
    });
  });
});
