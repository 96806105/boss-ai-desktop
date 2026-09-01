/**
 * SkillBase - 所有 Skill 的基类
 *
 * Skill 是比 Agent 更细粒度的能力单元：
 * - Agent = 编排层（组合多个 Skill 完成复杂任务）
 * - Skill = 能力层（单一职责：解析 JD / 搜索引擎 / 写作 / 风险评估）
 *
 * 生命周期：init → registerTool → shouldAutoTrigger / execute / getTool
 */
class SkillBase {
  /**
   * @param {object} manifest - Skill 声明（从 manifest.json 加载）
   */
  constructor(manifest) {
    this.manifest = manifest;
    this.id = manifest.id;
    this.name = manifest.name || manifest.id;
    this.version = manifest.version || "1.0.0";
    this.description = manifest.description || "";
    this.tools = {};           // Skill 提供的工具函数
    this.triggers = manifest.triggers || [];
    this.config = {};          // 运行时配置（从 manifest.config 初始化）
  }

  /**
   * 初始化 Skill（子类可覆写）
   * 在加载时调用一次，用于设置内部状态
   */
  async init(context = {}) {
    this.config = { ...(this.manifest.config || {}), ...(context.config || {}) };
  }

  /**
   * 注册一个工具函数
   * @param {string} name - 工具名
   * @param {function} handler - 工具函数 (input, context) => result
   */
  registerTool(name, handler) {
    this.tools[name] = handler;
  }

  /**
   * 获取工具函数
   * @param {string} name - 工具名
   * @returns {function|null}
   */
  getTool(name) {
    return this.tools[name] || null;
  }

  /**
   * 执行工具
   * @param {string} toolName - 工具名
   * @param {object} input - 工具输入
   * @param {object} context - 执行上下文（signal, tools, llm 等）
   * @returns {Promise<any>}
   */
  async executeTool(toolName, input, context = {}) {
    const tool = this.getTool(toolName);
    if (!tool) {
      throw new Error(`Tool not found: ${this.id}:${toolName}`);
    }
    if (context.signal && context.signal.aborted) {
      throw new Error("任务已取消");
    }
    return tool(input, context);
  }

  /**
   * 检查是否应该自主触发
   * 子类覆写此方法实现自动触发逻辑
   * @param {object} context - 触发上下文（page, event, data 等）
   * @returns {Promise<boolean>}
   */
  async shouldAutoTrigger(context) {
    return false;
  }

  /**
   * 自主触发时执行
   * 子类覆写此方法实现自动执行逻辑
   * @param {object} context - 触发上下文
   * @returns {Promise<object|null>} 执行结果
   */
  async onAutoTrigger(context) {
    return null;
  }

  /**
   * 执行 Skill 的主逻辑（子类必须覆写）
   * @param {string} action - 动作名
   * @param {object} input - 输入参数
   * @param {object} context - 执行上下文
   * @returns {Promise<any>}
   */
  async execute(action, input, context = {}) {
    throw new Error(`Skill ${this.id} must implement execute()`);
  }

  /**
   * 获取 Skill 信息
   */
  getInfo() {
    return {
      id: this.id,
      name: this.name,
      version: this.version,
      description: this.description,
      tools: Object.keys(this.tools),
      triggers: this.triggers
    };
  }
}

module.exports = { SkillBase };
