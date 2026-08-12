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

module.exports = { load, get, set, remove, getSettings };
