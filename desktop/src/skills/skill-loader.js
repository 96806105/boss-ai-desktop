/**
 * SkillLoader - Skill 插件加载器
 *
 * 职责：
 * - 扫描 skills/ 目录，自动发现并加载所有 Skill
 * - 动态注册/注销 Skill
 * - 合并所有 Skill 提供的工具
 * - 检查触发条件，支持自主触发
 */
const fs = require("fs");
const path = require("path");
const logger = require("../core/logger");

class SkillLoader {
  /**
   * @param {string} skillsDir - skills 目录路径
   */
  constructor(skillsDir) {
    this.skills = new Map();
    this.skillsDir = skillsDir;
  }

  /**
   * 扫描并加载所有 Skill
   * 每个 Skill 是一个目录，包含 manifest.json + index.js
   * @returns {SkillLoader}
   */
  loadAll() {
    if (!fs.existsSync(this.skillsDir)) {
      logger.warn("skill-loader", "skills directory not found:", this.skillsDir);
      return this;
    }

    const dirs = fs.readdirSync(this.skillsDir)
      .filter((d) => {
        const full = path.join(this.skillsDir, d);
        return fs.statSync(full).isDirectory() && d !== "node_modules";
      });

    for (const dir of dirs) {
      try {
        this._loadSkill(dir);
      } catch (err) {
        logger.error("skill-loader", `failed to load skill "${dir}":`, err.message);
      }
    }

    logger.info("skill-loader", `loaded ${this.skills.size} skills:`, Array.from(this.skills.keys()).join(", "));
    return this;
  }

  /**
   * 加载单个 Skill
   * @private
   */
  _loadSkill(dir) {
    const skillDir = path.join(this.skillsDir, dir);
    const manifestPath = path.join(skillDir, "manifest.json");
    const indexPath = path.join(skillDir, "index.js");

    if (!fs.existsSync(manifestPath)) {
      logger.warn("skill-loader", `skip "${dir}": no manifest.json`);
      return;
    }
    if (!fs.existsSync(indexPath)) {
      logger.warn("skill-loader", `skip "${dir}": no index.js`);
      return;
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const SkillClass = require(indexPath);

    if (typeof SkillClass !== "function") {
      logger.warn("skill-loader", `skip "${dir}": index.js must export a class`);
      return;
    }

    const skill = new SkillClass(manifest);

    // 验证 Skill 基类
    if (typeof skill.execute !== "function" || !skill.id) {
      logger.warn("skill-loader", `skip "${dir}": must have id and execute()`);
      return;
    }

    this.skills.set(manifest.id, skill);
    logger.info("skill-loader", `loaded skill: ${manifest.id} v${manifest.version || "1.0.0"}`);
  }

  /**
   * 动态注册 Skill
   * @param {SkillBase} skill - Skill 实例
   */
  register(skill) {
    if (!skill || !skill.id) {
      throw new Error("Invalid skill: missing id");
    }
    if (this.skills.has(skill.id)) {
      logger.warn("skill-loader", `skill "${skill.id}" already registered, replacing`);
    }
    this.skills.set(skill.id, skill);
    logger.info("skill-loader", `registered skill: ${skill.id}`);
  }

  /**
   * 注销 Skill
   * @param {string} skillId - Skill ID
   */
  unregister(skillId) {
    if (!this.skills.has(skillId)) return false;
    this.skills.delete(skillId);
    logger.info("skill-loader", `unregistered skill: ${skillId}`);
    return true;
  }

  /**
   * 获取 Skill
   * @param {string} skillId
   * @returns {SkillBase|null}
   */
  get(skillId) {
    return this.skills.get(skillId) || null;
  }

  /**
   * 获取所有 Skill 信息
   * @returns {object[]}
   */
  list() {
    return Array.from(this.skills.values()).map((s) => s.getInfo());
  }

  /**
   * 合并所有 Skill 提供的工具
   * 工具名格式: "skillId:toolName"（命名空间隔离）
   * @returns {object} 工具函数映射
   */
  getAllTools() {
    const tools = {};
    for (const [skillId, skill] of this.skills) {
      for (const [name, handler] of Object.entries(skill.tools)) {
        const toolId = `${skillId}:${name}`;
        tools[toolId] = {
          name: toolId,
          skillId,
          run: handler
        };
      }
    }
    return tools;
  }

  /**
   * 检查所有 Skill 的触发条件
   * @param {object} context - 触发上下文
   * @returns {Promise<Array<{skill, trigger}>>} 被触发的 Skill 和触发器
   */
  async checkTriggers(context) {
    const triggered = [];
    for (const [, skill] of this.skills) {
      for (const trigger of skill.triggers) {
        try {
          if (await skill.shouldAutoTrigger({ ...context, trigger })) {
            triggered.push({ skill, trigger });
          }
        } catch (err) {
          logger.warn("skill-loader", `trigger check failed for ${skill.id}:`, err.message);
        }
      }
    }
    return triggered;
  }

  /**
   * 初始化所有已加载的 Skill
   * @param {object} context - 初始化上下文
   */
  async initAll(context = {}) {
    for (const [id, skill] of this.skills) {
      try {
        await skill.init(context);
        logger.info("skill-loader", `initialized skill: ${id}`);
      } catch (err) {
        logger.error("skill-loader", `init failed for "${id}":`, err.message);
      }
    }
  }
}

module.exports = { SkillLoader };
