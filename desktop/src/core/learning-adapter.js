/**
 * LearningAdapter - 自适应学习模块
 *
 * 跟踪 agent 的 accept/modify/reject 事件，动态调整 prompt 策略
 */
const fs = require("fs");
const path = require("path");
const logger = require("../core/logger");

class LearningAdapter {
  /**
   * @param {string} dataDir - 学习数据存储目录
   */
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.filePath = path.join(dataDir, "learning-data.json");
    this.data = this._load();
  }

  /**
   * 加载学习数据
   * @private
   */
  _load() {
    try {
      if (fs.existsSync(this.filePath)) {
        return JSON.parse(fs.readFileSync(this.filePath, "utf8"));
      }
    } catch (e) {
      logger.warn("learning-adapter", `Failed to load learning data: ${e.message}`);
    }
    return { events: [], stats: {} };
  }

  /**
   * 保存学习数据
   * @private
   */
  _save() {
    try {
      if (!fs.existsSync(this.dataDir)) {
        fs.mkdirSync(this.dataDir, { recursive: true });
      }
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), "utf8");
    } catch (e) {
      logger.warn("learning-adapter", `Failed to save learning data: ${e.message}`);
    }
  }

  /**
   * 记录事件
   * @param {string} agentId - agent ID
   * @param {string} eventType - 事件类型: accept / modify / reject
   * @param {object} payload - 事件详情
   */
  recordEvent(agentId, eventType, payload = {}) {
    const event = {
      agentId,
      eventType,
      timestamp: Date.now(),
      ...payload
    };

    this.data.events.push(event);

    // 更新统计
    if (!this.data.stats[agentId]) {
      this.data.stats[agentId] = { accept: 0, modify: 0, reject: 0, total: 0 };
    }
    this.data.stats[agentId][eventType] = (this.data.stats[agentId][eventType] || 0) + 1;
    this.data.stats[agentId].total = (this.data.stats[agentId].total || 0) + 1;

    // 保留最近 500 条事件
    if (this.data.events.length > 500) {
      this.data.events = this.data.events.slice(-500);
    }

    this._save();
    logger.debug("learning-adapter", `Recorded ${eventType} for ${agentId}`);
  }

  /**
   * 获取 agent 的统计摘要
   * @param {string} agentId
   * @returns {object} { accept, modify, reject, total, acceptRate, modifyRate, rejectRate }
   */
  getStats(agentId) {
    const s = this.data.stats[agentId] || { accept: 0, modify: 0, reject: 0, total: 0 };
    const t = s.total || 1;
    return {
      ...s,
      acceptRate: s.accept / t,
      modifyRate: s.modify / t,
      rejectRate: s.reject / t
    };
  }

  /**
   * 获取 agent 的最近 N 条事件
   * @param {string} agentId
   * @param {number} count - 返回条数
   * @returns {Array}
   */
  getRecentEvents(agentId, count = 20) {
    return this.data.events
      .filter((e) => e.agentId === agentId)
      .slice(-count);
  }

  /**
   * 获取 agent 的拒绝模式分析
   * 识别常见的拒绝原因，用于调整 prompt
   * @param {string} agentId
   * @returns {object} { reasons: [{ reason, count, examples }], suggestion: string }
   */
  getRejectionPatterns(agentId) {
    const rejects = this.data.events.filter(
      (e) => e.agentId === agentId && e.eventType === "reject"
    );

    if (rejects.length === 0) {
      return { reasons: [], suggestion: "暂无拒绝数据" };
    }

    // 按拒绝原因分组
    const groups = {};
    for (const r of rejects) {
      const reason = (r.reason || "未分类").trim();
      if (!groups[reason]) groups[reason] = { reason, count: 0, examples: [] };
      groups[reason].count++;
      if (groups[reason].examples.length < 3 && r.example) {
        groups[reason].examples.push(r.example);
      }
    }

    const reasons = Object.values(groups).sort((a, b) => b.count - a.count);
    const topReason = reasons[0];

    let suggestion = "";
    if (topReason) {
      if (topReason.reason.includes("太正式") || topReason.reason.includes("书面")) {
        suggestion = "建议加强口语化表达，减少书面用语";
      } else if (topReason.reason.includes("太随意") || topReason.reason.includes("口语")) {
        suggestion = "建议适当增加正式感，但保持自然";
      } else if (topReason.reason.includes("AI") || topReason.reason.includes("机械")) {
        suggestion = "建议增加 few-shot 示例，加强语感锚定";
      } else {
        suggestion = `建议关注：${topReason.reason}（出现${topReason.count}次）`;
      }
    }

    return { reasons, suggestion };
  }

  /**
   * 获取建议的调整策略
   * @param {string} agentId
   * @returns {object} { acceptRate, rejectRate, strategy, adjustments }
   */
  getAdjustmentStrategy(agentId) {
    const stats = this.getStats(agentId);
    const patterns = this.getRejectionPatterns(agentId);

    let strategy = "maintain";
    const adjustments = [];

    if (stats.total < 10) {
      strategy = "collecting";
      adjustments.push("数据积累中，暂不调整");
    } else if (stats.rejectRate > 0.4) {
      strategy = "aggressive_adjust";
      adjustments.push("拒绝率过高，需要大幅调整 prompt");
    } else if (stats.rejectRate > 0.2) {
      strategy = "moderate_adjust";
      adjustments.push("拒绝率偏高，需要适度调整");
    } else if (stats.modifyRate > 0.5) {
      strategy = "fine_tune";
      adjustments.push("修改率较高，需要微调 prompt");
    } else if (stats.acceptRate > 0.7) {
      strategy = "maintain";
      adjustments.push("表现良好，保持当前策略");
    }

    if (patterns.suggestion) {
      adjustments.push(patterns.suggestion);
    }

    return {
      acceptRate: stats.acceptRate,
      rejectRate: stats.rejectRate,
      modifyRate: stats.modifyRate,
      strategy,
      adjustments
    };
  }
}

module.exports = { LearningAdapter };
