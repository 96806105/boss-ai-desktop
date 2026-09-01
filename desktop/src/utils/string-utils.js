/**
 * 字符串处理工具函数
 */

/** 清理乱码和特殊字符 */
function cleanText(s) {
  return String(s || "")
    .replace(/\uFFFD/g, "")
    .replace(/\u2028|\u2029/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** 字段值规范化："1000万人民币/1000万元" → "1000万" */
function normFieldVal(v) {
  return String(v || "")
    .replace(/([\d,.]+亿)(?:元|人民币)/, "$1")
    .replace(/([\d,.]+万)(?:元|人民币)/, "$1")
    .trim();
}

/** HTML 标签剥离 */
function stripTags(s) {
  return (s || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&ensp;/g, " ")
    .replace(/&#0183;/g, "·")
    .replace(/\s+/g, " ")
    .trim();
}

module.exports = { cleanText, normFieldVal, stripTags };
