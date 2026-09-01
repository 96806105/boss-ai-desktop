const fs = require("fs");
const path = require("path");
const { app } = require("electron");
const logger = require("./logger");

let store = {};
let writeTimer = null;

function storeFile() {
  return path.join(app.getPath("userData"), "settings.json");
}

function load() {
  try {
    store = JSON.parse(fs.readFileSync(storeFile(), "utf8"));
  } catch (e) {
    store = {};
  }
  logger.info("store", "loaded keys:", Object.keys(store).join(",") || "(empty)");
  return store;
}

function persist() {
  clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    try {
      fs.writeFileSync(storeFile(), JSON.stringify(store, null, 2), "utf8");
    } catch (e) {
      logger.error("store", "write failed:", e.message);
    }
  }, 150);
}

function get(key) {
  return store[key];
}

function set(obj) {
  const changed = [];
  for (const k of Object.keys(obj || {})) {
    if (JSON.stringify(store[k]) !== JSON.stringify(obj[k])) changed.push(k);
    store[k] = obj[k];
  }
  if (changed.length) persist();
  return changed;
}

function remove(key) {
  const existed = key in store;
  delete store[key];
  if (existed) persist();
  return existed;
}

function getSettings() {
  return store.bossAiSettings || {};
}

/**
 * 解析当前生效的简历文本（多简历支持）：
 * - 优先取 activeResumeId 命中的简历；
 * - 无命中取 resumes[0]；
 * - 无 resumes 时回退旧字段 resumeText（迁移兼容）。
 */
function resolveResume(settings) {
  const s = settings || {};
  const list = Array.isArray(s.resumes) ? s.resumes : [];
  const active = list.find((r) => r && r.id === s.activeResumeId) || list[0];
  if (active && String(active.text || "").trim()) return active.text;
  for (const r of list) {
    if (r && String(r.text || "").trim()) return r.text;
  }
  return String(s.resumeText || "");
}

module.exports = { load, get, set, remove, getSettings, resolveResume };
