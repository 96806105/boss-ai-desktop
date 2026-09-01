const {
  extractResumeKeywords,
  isTechJd,
  extractJdKeywords,
  extractJdNeeds,
  rankResume,
  isFreshman
} = require("../../../src/skills/resume-analysis/index");

describe("resume-analysis skill", () => {
  describe("extractResumeKeywords", () => {
    test("从简历中提取技能关键词", () => {
      const resume = "精通 Python 和 Java，熟悉 Vue 前端开发，有 React 项目经验";
      const keywords = extractResumeKeywords(resume);
      expect(keywords).toContain("python");
      expect(keywords).toContain("java");
      expect(keywords).toContain("vue");
      expect(keywords).toContain("react");
    });

    test("最多返回 8 个关键词", () => {
      const resume = "python java go golang c++ javascript vue react node flutter android ios";
      const keywords = extractResumeKeywords(resume);
      expect(keywords.length).toBeLessThanOrEqual(8);
    });

    test("空简历返回空数组", () => {
      expect(extractResumeKeywords("")).toEqual([]);
      expect(extractResumeKeywords(null)).toEqual([]);
    });
  });

  describe("isTechJd", () => {
    test("识别技术岗位", () => {
      expect(isTechJd({ title: "Python 开发工程师" })).toBe(true);
      expect(isTechJd({ title: "前端开发", tags: "Vue React" })).toBe(true);
      expect(isTechJd({ desc: "负责后端接口开发，使用 Java Spring 框架" })).toBe(true);
    });

    test("识别非技术岗位", () => {
      expect(isTechJd({ title: "行政助理" })).toBe(false);
      expect(isTechJd({ title: "销售经理", tags: "销售 客户" })).toBe(false);
    });
  });

  describe("extractJdKeywords", () => {
    test("从 JD 提取关键词", () => {
      const jd = {
        title: "Python 数据分析师",
        tags: "数据分析 Python SQL",
        desc: "负责数据清洗和分析，使用 Python 和 SQL 进行数据处理"
      };
      const result = extractJdKeywords(jd);
      expect(result.words).toContain("python");
      expect(result.words).toContain("sql");
      expect(result.words).toContain("数据分析");
    });

    test("空 JD 返回空结果", () => {
      const result = extractJdKeywords({});
      expect(result.words).toHaveLength(0);
    });
  });

  describe("extractJdNeeds", () => {
    test("提取 JD 核心需求点", () => {
      const jd = {
        desc: "负责数据分析工作。熟悉 Python 编程。掌握 SQL 数据库操作。具备良好的沟通能力。"
      };
      const needs = extractJdNeeds(jd, true);
      expect(needs.length).toBeGreaterThan(0);
      expect(needs.some((n) => n.includes("Python"))).toBe(true);
    });

    test("非技术岗位包含软技能", () => {
      const jd = {
        desc: "负责客户沟通。具备良好的服务意识。跟进项目进度。"
      };
      const needs = extractJdNeeds(jd, false);
      expect(needs.length).toBeGreaterThan(0);
    });
  });

  describe("rankResume", () => {
    test("高相关片段进入 high 列表", () => {
      const resume = "精通 Python 数据分析，有 SQL 数据库经验\n\n做过行政工作";
      const keywords = ["python", "sql"];
      const result = rankResume(resume, keywords, [], true);
      expect(result.high.length).toBeGreaterThan(0);
      expect(result.high[0].hits).toContain("python");
    });

    test("低相关片段进入 low 列表", () => {
      const resume = "精通 Python\n\n喜欢看电影和听音乐";
      const keywords = ["python"];
      const result = rankResume(resume, keywords, [], true);
      expect(result.low.length).toBeGreaterThan(0);
    });

    test("空简历返回空结果", () => {
      const result = rankResume("", [], [], true);
      expect(result.high).toHaveLength(0);
      expect(result.low).toHaveLength(0);
    });
  });

  describe("isFreshman", () => {
    test("识别应届生", () => {
      expect(isFreshman("2025届应届毕业生")).toBe(true);
      expect(isFreshman("在读研究生")).toBe(true);
      expect(isFreshman("大四学生")).toBe(true);
    });

    test("非应届生返回 false", () => {
      expect(isFreshman("3年工作经验")).toBe(false);
      expect(isFreshman("")).toBe(false);
    });
  });
});
