const { extractFields } = require("../../../src/skills/web-intelligence/index");

describe("web-intelligence skill", () => {
  describe("extractFields", () => {
    test("从搜索摘要中提取注册资本", () => {
      const texts = ["该公司注册资本：1000万元人民币，实缴资本：500万元"];
      const fields = extractFields(texts);
      expect(fields["注册资本"]).toBeDefined();
      expect(fields["注册资本"].value).toBe("1000万人民币"); // normFieldVal 只处理 "万元" → "万"，不处理 "万人民币"
      expect(fields["实缴资本"]).toBeDefined();
      expect(fields["实缴资本"].value).toBe("500万");
    });

    test("提取成立时间", () => {
      const texts = ["成立时间：2020年05月15日"];
      const fields = extractFields(texts);
      expect(fields["成立时间"]).toBeDefined();
      expect(fields["成立时间"].value).toContain("2020");
    });

    test("提取法定代表人", () => {
      const texts = ["法定代表人：张三"];
      const fields = extractFields(texts);
      expect(fields["法定代表人"]).toBeDefined();
      expect(fields["法定代表人"].value).toBe("张三");
    });

    test("提取信用代码", () => {
      const texts = ["统一社会信用代码：91110105MA01D1234X"];
      const fields = extractFields(texts);
      expect(fields["信用代码"]).toBeDefined();
      expect(fields["信用代码"].value).toBe("91110105MA01D1234X");
    });

    test("多值投票（取出现次数最多的）", () => {
      const texts = [
        "注册资本：1000万元",
        "该公司注册资本1000万元",
        "注册资本：800万元"
      ];
      const fields = extractFields(texts);
      expect(fields["注册资本"].value).toBe("1000万");
      expect(fields["注册资本"].count).toBe(2);
    });

    test("处理空输入", () => {
      const fields = extractFields([]);
      expect(Object.keys(fields)).toHaveLength(0);
    });

    test("清理乱码字符", () => {
      const texts = ["注册资本\ufffd：1000万元"];
      const fields = extractFields(texts);
      expect(fields["注册资本"]).toBeDefined();
    });
  });
});
