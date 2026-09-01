const { splitVersions, extractVersionTexts } = require("../../../src/utils/text-parsing");

describe("text-parsing", () => {
  describe("splitVersions", () => {
    test("分割【版本N】格式", () => {
      const text = "【版本1】第一个招呼语\n【版本2】第二个招呼语";
      const versions = splitVersions(text);
      expect(versions).toHaveLength(2);
      expect(versions[0]).toBe("第一个招呼语");
      expect(versions[1]).toBe("第二个招呼语");
    });

    test("分割【版本一】【版本二】格式", () => {
      const text = "【版本一】第一个\n【版本二】第二个";
      const versions = splitVersions(text);
      expect(versions).toHaveLength(2);
    });

    test("分割「版本1：」格式", () => {
      const text = "版本1：第一个招呼语\n版本2：第二个招呼语";
      const versions = splitVersions(text);
      expect(versions).toHaveLength(2);
      expect(versions[0]).toBe("第一个招呼语");
    });

    test("分割「第N个版本」格式", () => {
      const text = "第1个版本：第一个\n第2个版本：第二个";
      const versions = splitVersions(text);
      expect(versions).toHaveLength(2);
    });

    test("分割「数字、」格式", () => {
      const text = "1、第一个招呼语\n2、第二个招呼语";
      const versions = splitVersions(text);
      expect(versions).toHaveLength(2);
    });

    test("处理空文本", () => {
      expect(splitVersions("")).toEqual([]);
      expect(splitVersions(null)).toEqual([]);
    });

    test("单版本文本返回单元素数组", () => {
      const text = "这是一段普通文本";
      const versions = splitVersions(text);
      expect(versions).toHaveLength(1);
      expect(versions[0]).toBe("这是一段普通文本");
    });

    test("无版本标记按空行分割", () => {
      const text = "第一段内容\n\n第二段内容";
      const versions = splitVersions(text);
      expect(versions).toHaveLength(2);
    });

    test("保留版本内换行", () => {
      const text = "【版本1】第一行\n第二行\n【版本2】另一个";
      const versions = splitVersions(text);
      expect(versions).toHaveLength(2);
      expect(versions[0]).toBe("第一行\n第二行");
    });
  });

  describe("extractVersionTexts", () => {
    test("提取【版本N】标记的文本", () => {
      const text = "一些前缀\n【版本1】第一个版本内容\n一些中间\n【版本2】第二个版本内容\n后缀";
      const result = extractVersionTexts(text);
      expect(result.length).toBeGreaterThanOrEqual(1);
    });

    test("过滤过短的版本（< 10字符）", () => {
      const text = "【版本1】短\n【版本2】这是一个足够长的版本文本内容";
      const result = extractVersionTexts(text);
      expect(result).toHaveLength(1);
      expect(result[0]).toContain("足够长");
    });

    test("无版本标记返回空数组", () => {
      const text = "普通文本没有版本标记";
      const result = extractVersionTexts(text);
      expect(result).toEqual([]);
    });
  });
});
