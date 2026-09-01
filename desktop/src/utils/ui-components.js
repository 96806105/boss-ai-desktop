/**
 * 可复用 UI 组件工厂函数
 * 从 panel.js 中抽取的重复组件创建逻辑
 */

const { escHtml } = require("./dom-helpers");

/**
 * 创建按钮
 * @param {string} text - 按钮文字
 * @param {function} onclick - 点击回调
 * @param {object} opts - 可选配置 { className, disabled }
 * @returns {HTMLButtonElement}
 */
function mkBtn(text, onclick, opts = {}) {
  const b = document.createElement("button");
  b.className = opts.className || "btn secondary sm";
  b.textContent = text;
  b.onclick = onclick;
  if (opts.disabled) b.disabled = true;
  return b;
}

/**
 * 创建 JD 信息卡片
 * @param {object} jd - 职位信息 { title, salary, company, desc }
 * @returns {HTMLDivElement}
 */
function jdBox(jd) {
  const el = document.createElement("div");
  el.className = "jd-box";
  el.innerHTML =
    "<b>" + escHtml(jd.title || "职位") + "</b>" +
    (jd.salary ? " · " + escHtml(jd.salary) : "") +
    (jd.company ? " · " + escHtml(jd.company) : "") +
    "<br>" + escHtml(jd.desc ? jd.desc.slice(0, 120) : "未获取到职位描述");
  return el;
}

/**
 * 创建版本卡片（招呼语/回复）
 * @param {string} tag - 标签文字（如 "招呼语 1"）
 * @param {string} text - 正文内容
 * @param {object} opts - 配置 { kind, actions }
 * @returns {HTMLDivElement}
 */
function versionCard(tag, text, opts = {}) {
  const card = document.createElement("div");
  card.className = "ver";
  card.innerHTML =
    '<span class="tag">' + escHtml(tag) + '</span>' +
    '<div class="txt"></div>' +
    '<div class="ops"></div>';

  card.querySelector(".txt").textContent = text;

  const ops = card.querySelector(".ops");
  if (opts.actions) {
    for (const action of opts.actions) {
      ops.appendChild(mkBtn(action.text, action.onclick));
    }
  }

  return card;
}

module.exports = { mkBtn, jdBox, versionCard };
