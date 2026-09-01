/**
 * 工具函数统一导出
 */
const dom = require("./dom-helpers");
const text = require("./text-parsing");
const str = require("./string-utils");
const { createStatusHelper } = require("./status-helpers");
const ui = require("./ui-components");

module.exports = {
  ...dom,
  ...text,
  ...str,
  createStatusHelper,
  ...ui
};
