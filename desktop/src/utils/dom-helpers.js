/**
 * DOM 相关工具函数
 * 从 panel.js 和 content.js 中抽取的重复逻辑
 */

/** XSS 转义（HTML 实体编码） */
function escHtml(s) {
  return String(s || "").replace(/[&<>"']/g, (m) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[m]));
}

/** 文本截断，超出长度追加省略号 */
function truncate(text, n) {
  text = String(text || "");
  return text.length > n ? text.slice(0, n) + "…" : text;
}

/** 判断元素是否可见（宽高 > 0） */
function isVisible(el) {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

/** 安全获取元素文本（去除多余空白和零宽字符） */
function pickText(selectors, root = document) {
  for (const sel of selectors) {
    const el = root.querySelector(sel);
    if (el && el.textContent && el.textContent.trim()) {
      return el.textContent.trim().replace(/\s+/g, " ").replace(/\u200b/g, "");
    }
  }
  return "";
}

/** 安全获取元素文本列表 */
function pickTextList(selectors, root = document) {
  for (const sel of selectors) {
    const els = root.querySelectorAll(sel);
    const arr = Array.from(els)
      .map((el) => el.textContent.trim().replace(/\s+/g, " "))
      .filter(Boolean);
    if (arr.length) return arr;
  }
  return [];
}

module.exports = { escHtml, truncate, isVisible, pickText, pickTextList };
