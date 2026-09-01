const { riskScanLocal } = require("../../../src/skills/risk-assessment/index");

describe("risk-assessment skill", () => {
  describe("riskScanLocal", () => {
    test("检测到培训费/押金", () => {
      const jd = { desc: "入职前需缴纳培训费2000元", hasJd: true };
      const result = riskScanLocal(jd, "");
      expect(result.hits.length).toBeGreaterThan(0);
      expect(result.hits.some((h) => h.label.includes("交费"))).toBe(true);
      expect(result.score).toBeGreaterThanOrEqual(3);
    });

    test("检测到身份证抵押", () => {
      const jd = { desc: "入职需要身份证复印件", hasJd: true };
      const result = riskScanLocal(jd, "请把身份证拍照发给我");
      expect(result.hits.some((h) => h.label.includes("身份证"))).toBe(true);
    });

    test("检测到低门槛高薪", () => {
      const jd = {
        desc: "接受应届生，无经验要求",
        salary: "15K-20K",
        hasJd: true
      };
      const result = riskScanLocal(jd, "");
      expect(result.hits.some((h) => h.label.includes("低门槛"))).toBe(true);
    });

    test("检测到劳务派遣", () => {
      const jd = { company: "某劳务派遣有限公司", hasJd: true };
      const result = riskScanLocal(jd, "");
      expect(result.hits.some((h) => h.label.includes("劳务派遣"))).toBe(true);
    });

    test("检测到聊天中的培训贷", () => {
      const jd = { hasJd: true };
      const result = riskScanLocal(jd, "我们这边是先培训后就业，可以办理分期");
      expect(result.hits.some((h) => h.label.includes("培训"))).toBe(true);
      expect(result.score).toBeGreaterThanOrEqual(3);
    });

    test("正常岗位无风险", () => {
      const jd = {
        title: "Python开发工程师",
        desc: "负责后端开发工作，要求3年以上的Python开发经验，熟悉Django或Flask框架",
        salary: "15K-25K",
        company: "某科技有限公司",
        hasJd: true
      };
      const result = riskScanLocal(jd, "");
      expect(result.score).toBe(0);
      expect(result.tag).toBe("未见明显静态信号");
    });

    test("空输入返回正常", () => {
      const result = riskScanLocal(null, "");
      expect(result.score).toBe(0);
    });
  });
});
