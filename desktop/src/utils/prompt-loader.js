/**
 * PromptLoader - Prompt 模板加载器
 *
 * 从 prompts/ 目录加载 Markdown 格式的 prompt 模板
 * 支持模板变量替换（{{variable}}）
 */
const fs = require("fs");
const path = require("path");
const logger = require("../core/logger");

class PromptLoader {
  /**
   * @param {string} promptsDir - prompts 目录路径
   */
  constructor(promptsDir) {
    this.promptsDir = promptsDir;
    this.cache = new Map();
  }

  /**
   * 加载 prompt 模板
   * @param {string} agentId - agent/场景 ID（如 "greeting", "reply"）
   * @param {string} filename - 文件名（如 "system.md", "rules.md"）
   * @returns {string} prompt 内容
   */
  load(agentId, filename) {
    const key = `${agentId}:${filename}`;
    if (this.cache.has(key)) return this.cache.get(key);

    const filePath = path.join(this.promptsDir, agentId, filename);
    if (!fs.existsSync(filePath)) {
      logger.warn("prompt-loader", `prompt not found: ${filePath}`);
      return "";
    }

    const content = fs.readFileSync(filePath, "utf8");
    this.cache.set(key, content);
    return content;
  }

  /**
   * 加载并渲染 prompt 模板（替换 {{variable}}）
   * @param {string} agentId
   * @param {string} filename
   * @param {object} vars - 变量映射 { key: value }
   * @returns {string} 渲染后的 prompt
   */
  render(agentId, filename, vars = {}) {
    let content = this.load(agentId, filename);
    for (const [k, v] of Object.entries(vars)) {
      content = content.replace(new RegExp(`\\{\\{${k}\\}\\}`, "g"), v);
    }
    return content;
  }

  /**
   * 清除缓存（用于热更新 prompt）
   */
  clearCache() {
    this.cache.clear();
  }

  /**
   * 获取 agent 的所有 prompt 文件
   * @param {string} agentId
   * @returns {string[]}
   */
  listFiles(agentId) {
    const dir = path.join(this.promptsDir, agentId);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
  }
}

module.exports = { PromptLoader };
