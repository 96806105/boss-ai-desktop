const logger = require("./logger");

const API_BASE = "https://api.deepseek.com/chat/completions";
const DEFAULT_MODEL = "deepseek-chat";
const TIMEOUT_MS = 120000;

let usageStat = { calls: 0, tokens: 0, errors: 0 };

/**
 * 构建请求体：deepseek-reasoner 不支持 temperature 等采样参数，需按模型裁剪。
 */
function buildBody(model, messages, temperature) {
  const m = model || DEFAULT_MODEL;
  const body = { model: m, messages, stream: false };
  if (!/reasoner/i.test(m)) body.temperature = temperature ?? 0.7;
  return body;
}

/**
 * 模型网关：统一错误归一、超时、可重试（5xx/429/超时）、用量统计。
 * 支持外部取消：传入 signal（如用户点击"停止"），中断后立即抛出"任务已取消"。
 * @returns {Promise<{text:string, usage:object}>}
 */
async function call({ apiKey, model, messages, temperature, maxRetries = 2, signal }) {
  if (!apiKey) throw new Error("未配置 API Key，请在设置页填写");
  if (signal && signal.aborted) throw new Error("任务已取消");
  let lastErr = null;
  const started = Date.now();
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const timeout = AbortSignal.timeout(TIMEOUT_MS);
    const abort = signal && !signal.aborted ? AbortSignal.any([signal, timeout]) : timeout;
    try {
      const res = await fetch(API_BASE, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + apiKey
        },
        body: JSON.stringify(buildBody(model, messages, temperature)),
        signal: abort
      });

      const json = await res.json().catch(() => null);
      if (!res.ok) {
        const msg = json && json.error && json.error.message ? json.error.message : "HTTP " + res.status;
        if (res.status >= 500 || res.status === 429) {
          lastErr = new Error(msg);
          logger.warn("llm", `attempt ${attempt + 1} retryable error:`, msg);
          continue;
        }
        throw new Error(msg);
      }
      const text = json && json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
      if (!text) throw new Error("模型未返回内容");
      const usage = json.usage || {};
      usageStat.calls++;
      usageStat.tokens += usage.total_tokens || 0;
      logger.info("llm", `ok model=${model || DEFAULT_MODEL} tokens=${usage.total_tokens || "?"} cost=${Date.now() - started}ms`);
      return { text, usage };
    } catch (err) {
      if (signal && signal.aborted) throw new Error("任务已取消");
      const isTimeout = err && (err.name === "AbortError" || err.name === "TimeoutError" || err.code === "UND_ERR_CONNECT_TIMEOUT");
      lastErr = isTimeout ? new Error("请求超时，请稍后重试") : err;
      logger.warn("llm", `attempt ${attempt + 1} failed:`, lastErr.message);
    }
  }
  usageStat.errors++;
  throw lastErr || new Error("模型调用失败");
}

function getStats() {
  return { ...usageStat };
}

module.exports = { call, getStats, DEFAULT_MODEL, buildBody };
