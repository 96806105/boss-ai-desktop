const { EventEmitter } = require("events");
const logger = require("./core/logger");
const store = require("./core/store");
const llm = require("./core/llm");
const { TOOLS } = require("./core/tools");
const { registry } = require("./registry");

const LOG_KEY = "bossAiAgentLog";
const LOG_CAP = 60;

/**
 * Orchestrator（Supervisor 模式）：
 * - 统一接收任务（invoke），按意图路由到注册的 Worker Agent；
 * - 组装共享上下文（settings/llm/tools/信号/进度回调），保证 Agent 间的隔离与可观测；
 * - 记录任务记忆（agentLog），供 UI「智能体活动」页展示；
 * - 并发保护：同一时刻只允许一个 Agent 任务在跑（避免 API 消耗失控）；
 * - 取消机制：每个任务绑定 AbortController，UI 可随时 cancel() 中断（LLM 请求/网络检索立即终止）。
 */
class Orchestrator extends EventEmitter {
  constructor() {
    super();
    this.busy = false;
    this.abort = null;
    this.current = null;
  }

  _ctxFor(extra, signal) {
    return {
      settings: store.getSettings(),
      llm,
      tools: TOOLS,
      signal: (extra && extra.signal) || signal,
      onProgress: extra && extra.onProgress
    };
  }

  _logEntry(entry) {
    const list = store.get(LOG_KEY) || [];
    list.unshift({ ts: Date.now(), ...entry });
    if (list.length > LOG_CAP) list.length = LOG_CAP;
    store.set({ [LOG_KEY]: list });
  }

  getLog(limit) {
    return (store.get(LOG_KEY) || []).slice(0, limit || 20);
  }

  isBusy() {
    return this.busy;
  }

  /** 当前运行中的任务信息（UI 展示"停止"按钮用） */
  getCurrent() {
    return this.current;
  }

  /** 取消当前任务；无任务或已取消返回 false */
  cancel() {
    if (!this.abort || this.abort.signal.aborted) return false;
    this.abort.abort();
    return true;
  }

  clearLog() {
    store.remove(LOG_KEY);
    return true;
  }

  async invoke(intent, input, extra = {}) {
    const agent = registry.get(intent);
    if (!agent) throw new Error("未知智能体：" + intent);
    if (this.busy) {
      const cur = this.current;
      throw new Error(cur ? "已有任务执行中（" + cur.agentName + "），请先停止再继续" : "已有任务执行中，请稍候");
    }
    this.busy = true;
    const controller = new AbortController();
    this.abort = controller;
    this.current = { intent, agentName: agent.name, ts: Date.now() };
    const started = Date.now();
    const ctx = this._ctxFor(extra, controller.signal);
    this.emit("agent:start", { intent, agentName: agent.name, ts: started });
    this._logEntry({ type: "start", intent, agent: agent.id, agentName: agent.name, task: String(input || "").slice(0, 200) });
    try {
      const res = await agent.execute(input, ctx);
      this._logEntry({ type: "done", intent, agent: agent.id, ms: Date.now() - started, chars: res.text.length });
      this.emit("agent:done", { intent, agentName: agent.name, ms: Date.now() - started });
      return res;
    } catch (err) {
      if (controller.signal.aborted || (ctx.signal && ctx.signal.aborted)) {
        this._logEntry({ type: "cancelled", intent, agent: agent.id, ms: Date.now() - started });
        this.emit("agent:cancelled", { intent, agentName: agent.name, ms: Date.now() - started });
        throw new Error("任务已停止");
      }
      logger.error("orchestrator", intent, "failed:", err.message);
      this._logEntry({ type: "error", intent, agent: agent.id, error: String((err && err.message) || err) });
      this.emit("agent:error", { intent, agentName: agent.name, error: String((err && err.message) || err) });
      throw err;
    } finally {
      this.busy = false;
      this.abort = null;
      this.current = null;
    }
  }
}

module.exports = new Orchestrator();
