const fs = require("fs");
const path = require("path");

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
let threshold = LEVELS.info;
let logStream = null;
let logDir = "";

function safeString(v) {
  if (typeof v === "string") return v;
  try { return JSON.stringify(v); } catch (e) { return String(v); }
}

function init(opts = {}) {
  if (opts.level && LEVELS[opts.level] != null) threshold = LEVELS[opts.level];
  logDir = opts.dir || "";
  if (logDir) {
    try {
      fs.mkdirSync(logDir, { recursive: true });
      const file = path.join(logDir, "app.log");
      logStream = fs.createWriteStream(file, { flags: "a" });
    } catch (e) { /* 日志文件不可用时静默降级 */ }
  }
}

function fmt(levelName, scope, args) {
  const t = new Date().toISOString().replace("T", " ").slice(0, 19);
  const body = args.map(safeString).join(" ");
  return `[${t}] [${levelName.toUpperCase().padEnd(5)}] [${scope}] ${body}`;
}

function log(levelName, scope, args) {
  if (LEVELS[levelName] < threshold) return;
  const line = fmt(levelName, scope, args);
  console.log(line);
  if (logStream) { try { logStream.write(line + "\n"); } catch (e) {} }
}

module.exports = {
  init,
  debug: (scope, ...a) => log("debug", scope, a),
  info: (scope, ...a) => log("info", scope, a),
  warn: (scope, ...a) => log("warn", scope, a),
  error: (scope, ...a) => log("error", scope, a)
};
