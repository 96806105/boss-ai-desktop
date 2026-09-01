/**
 * 文本解析工具函数
 * 统一 splitVersions 实现（原 greeting.js / panel.js / content.js 各有一份）
 */

/** 版本分隔符正则 */
const VERSION_MARKER = /^\s*(?:【\s*(?:版本\s*)?[0-9一二三四五六七八九十]+\s*】|版本\s*[0-9一二三四五六七八九十]+\s*[：:、.．]?|第\s*[0-9一二三四五六七八九十]+\s*(?:个版本|版)\s*[：:、.．]?|[0-9一二三四五六七八九十]+\s*[、.．:：])\s*/;

/**
 * 将 LLM 输出文本按版本标记分割
 * 支持格式：【版本1】【版本2】、版本1：、第1个版本、1、
 * @param {string} text - LLM 输出的完整文本
 * @returns {string[]} 分割后的版本文本数组
 */
function splitVersions(text) {
  const t = (text || "").trim();
  if (!t) return [];

  const versions = [];
  let cur = "";

  for (const line of t.split(/\r?\n/)) {
    const m = line.match(VERSION_MARKER);
    if (m) {
      if (cur) versions.push(cur.trim());
      cur = line.slice(m[0].length).trim();
    } else {
      cur += (cur ? "\n" : "") + line;
    }
  }
  if (cur) versions.push(cur.trim());

  const list = versions.filter(Boolean);
  if (list.length >= 2) return list;

  // 兜底：按空行分割
  const lines = t.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  return lines.length >= 2 ? lines : [t];
}

/** 从标记中提取【版本N】标记的版本文本（greeting agent 专用） */
function extractVersionTexts(text) {
  const t = String(text || "");
  const re = /【\s*版本\s*[0-9一二三四五六七八九十]+\s*】/g;
  const out = [];
  let last = null;
  let m;

  while ((m = re.exec(t))) {
    if (last) out.push(t.slice(last.end, m.index).trim());
    last = { end: m.index + m[0].length };
  }
  if (last) out.push(t.slice(last.end).trim());

  return out.filter((s) => s.length >= 10);
}

module.exports = { splitVersions, extractVersionTexts, VERSION_MARKER };
