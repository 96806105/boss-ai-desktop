/**
 * JdParsingSkill - JD 解析器 Skill
 *
 * 从 content.js 抽取的 JD 提取能力，提供：
 * - 职位详情页 JD 提取
 * - 聊天页消息采集
 * - 聊天输入框定位
 * - BOSS 薪资字体解码
 */
const { SkillBase } = require("../skill-base");
const { pickText, pickTextList } = require("../../utils/dom-helpers");

/**
 * BOSS 直聘薪资字体加密解码：U+E031~U+E03A 对应 0~9
 */
function decodePuaSalary(text) {
  return Array.from(text || "").map((ch) => {
    const cp = ch.codePointAt(0);
    return cp >= 0xE031 && cp <= 0xE03A ? String(cp - 0xE031) : ch;
  }).join("");
}

class JdParsingSkill extends SkillBase {
  constructor(manifest, selectorsConfig) {
    super(manifest);
    this.selectors = (selectorsConfig && selectorsConfig.selectors) || {};
    this.urlPatterns = (selectorsConfig && selectorsConfig.urlPatterns) || {};
    this.hitStats = (selectorsConfig && selectorsConfig.hitStats) || {};

    // 注册工具
    this.registerTool("extractFromPage", async (input, ctx) => {
      return this.extractFromHtml(input.html, input.url);
    });

    this.registerTool("decodePuaSalary", async (input) => {
      return decodePuaSalary(input.text);
    });
  }

  /**
   * 记录选择器命中（用于淘汰无效选择器）
   */
  recordHit(selector) {
    this.hitStats[selector] = (this.hitStats[selector] || 0) + 1;
  }

  /**
   * 带命中记录的 pickText
   */
  pickTextTracked(selectors, root = document) {
    for (const sel of selectors) {
      const el = root.querySelector(sel);
      if (el && el.textContent && el.textContent.trim()) {
        this.recordHit(sel);
        return el.textContent.trim().replace(/\s+/g, " ").replace(/\u200b/g, "");
      }
    }
    return "";
  }

  /**
   * 从 HTML 字符串提取 JD（用于测试和非浏览器环境）
   */
  extractFromHtml(html, url = "") {
    // 简化的 HTML 解析（测试用）
    const title = this._extractBySelector(html, this.selectors.jobDetail?.title || []);
    const salary = this._extractBySelector(html, this.selectors.jobDetail?.salary || []);
    const company = this._extractBySelector(html, this.selectors.jobDetail?.company || []);

    const onDetail = /job_detail|jobDetail|web\/geek\/job[?/]|\/web\/geek\/job\b/.test(url);
    const hasJd = onDetail && !!(title && salary);

    return { hasJd, title, salary, company, tags: "", desc: "" };
  }

  /**
   * 简单的 HTML 文本提取（测试用）
   */
  _extractBySelector(html, selectors) {
    // 在非浏览器环境下，用正则简单提取
    for (const sel of selectors) {
      // 提取标签内容
      const tagMatch = sel.match(/^(\w+)/);
      if (tagMatch) {
        const tag = tagMatch[1];
        const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
        const m = html.match(re);
        if (m) {
          const text = m[1].replace(/<[^>]+>/g, "").trim();
          if (text) return text;
        }
      }
    }
    return "";
  }
}

module.exports = { JdParsingSkill, decodePuaSalary };
