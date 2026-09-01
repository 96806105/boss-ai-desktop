/**
 * 状态提示工厂函数
 * 统一 setStatus / setPrepStatus / setCoStatus / setBatchStatus 等重复逻辑
 */

/**
 * 创建一个状态设置函数
 * @param {string} prefix - CSS class 前缀（如 "" / "prep" / "co" / "batch"）
 * @returns {function(string, boolean, HTMLElement): void}
 */
function createStatusHelper(prefix = "") {
  const defaultId = prefix ? `#${prefix}Status` : "#status";

  return function setStatus(text, isErr, el) {
    if (typeof el === "string") el = document.querySelector(el);
    if (!el) el = document.querySelector(defaultId);
    if (!el) return;

    el.textContent = text || "";
    const baseClass = prefix ? `${prefix}-status` : "status";
    el.className = baseClass + (isErr ? " err" : "") + (text && !isErr ? " busy" : "");
  };
}

module.exports = { createStatusHelper };
