/**
 * RiskAssessmentSkill - 风险评估器 Skill
 *
 * 从 content.js 抽取的本地静态风险检查能力：
 * - 培训费/押金检测
 * - 身份证抵押检测
 * - 低门槛高薪检测
 * - 劳务派遣检测
 * - 急招/长期挂岗检测
 */
const { SkillBase } = require("../skill-base");

/**
 * 本地静态风险检查单（零延迟）
 * @param {object} jd - 职位信息 { desc, tags, salary, company, hasJd }
 * @param {string} chatText - 聊天文本
 * @returns {{ score: number, hits: Array, tag: string }}
 */
function riskScanLocal(jd, chatText) {
  const d = (jd && jd.desc) || "";
  const t = (jd && jd.tags) || "";
  const s = (jd && jd.salary) || "";
  const c = (jd && jd.company) || "";
  const chat = (chatText || "").slice(-800);
  const all = d + " " + t + " " + chat;
  const hits = [];
  const hit = (level, label, tip) => hits.push({ level, label, tip });

  if (/培训费|押金|保证金|先交|交费|收费|费用自理|培训贷|分期付款/.test(all))
    hit(3, "涉及交费/押金/培训贷", "正规企业不会向求职者收费——聊到钱直接放弃并到平台举报。");
  if (/身份证/.test(all) && /复印件|拍照|抵押|押/.test(all))
    hit(3, "要求身份证复印件/抵押", "入职前只需出示原件核验，要求留存复印件或扣押证件的都有风险。");
  if (/经验不限|无经验|应届生|接受小白/.test(all) && /1[3-9]K|2\dK|3\dK/.test(s) && d.length < 150)
    hit(2, "低门槛 + 高薪（" + s + "）", "高薪无门槛最可疑，面试必问薪资结构：底薪多少、绩效占比、有无隐形扣款。");
  if (!(jd && jd.hasJd) ? false : (!d && !t)) hit(1, "岗位描述极简/缺失", "JD 没有实质内容，可能是批量挂岗或信息收集，先查清楚再投。");
  else if (jd && jd.hasJd && d.length < 30) hit(1, "岗位描述极简（不足 30 字）", "描述过于简略，警惕批量挂岗。");
  if (/成为.{0,6}(自己|骄傲)|改变命运|人生赢家|共创辉煌|实现梦想/.test(all))
    hit(1, "励志口号式文案", "画饼文案常见于销售/培训类岗位，确认清楚再投。");
  if (/面议|薪资面议|上不封顶|综合薪资/.test(all))
    hit(1, "薪资含糊", "面试必问：底薪、绩效结构、社保基数、转正规则。");
  if (/劳务|人力|派遣|外包/.test(c))
    hit(2, "劳务派遣/外包特征", "确认用工主体是谁（签合同的公司），务必问清五险一金与转正机制。");
  if (/旗下|隶属|子公司|集团|上市|分支|分部/.test(d + c))
    hit(1, "攀附大厂表述", "确认与所称大厂的真实关系，别把关联公司当大厂直招。");
  if (/什么都能|全能|多面手|啥都做/.test(all) || (d.match(/负责/g) || []).length >= 3)
    hit(1, "职责空洞（什么都能干）", "职责不清的岗位，入职后往往身兼多职。");
  if (/急招|长期招|大量招|随时入职/.test(all))
    hit(1, "急招/长期挂岗话术", "常年挂在平台的岗位，小心是信息收集或 KPI 牛。");
  if (/培训$|先培训|收徒|学费|贷款|办卡/.test(chat))
    hit(3, "聊天出现培训/贷款字样", "凡是要你先培训交钱、贷款分期、办卡的，一律拉黑并举报。");

  return {
    score: hits.reduce((n, h) => n + h.level, 0),
    hits,
    tag: hits.length ? (hits.some((h) => h.level >= 2) ? "存在可疑信号" : "仅轻微信号") : "未见明显静态信号"
  };
}

class RiskAssessmentSkill extends SkillBase {
  constructor(manifest) {
    super(manifest);

    this.registerTool("localRiskScan", async (input) => {
      return riskScanLocal(input.jd, input.chatText);
    });
  }
}

module.exports = { RiskAssessmentSkill, riskScanLocal };
