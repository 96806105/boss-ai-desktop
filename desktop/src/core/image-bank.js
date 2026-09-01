const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { app, dialog } = require("electron");
const store = require("./store");
const logger = require("./logger");

const KEY = "bossAiResumeImages";

function dir() {
  const d = path.join(app.getPath("userData"), "resume-images");
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  return d;
}

function list() {
  return (store.get(KEY) || []).slice();
}

/** 弹出系统文件选择框，选择图片后复制进图片库，返回最新列表 */
async function pick(win) {
  const r = await dialog.showOpenDialog(win || null, {
    title: "选择简历图片（可多选）",
    properties: ["openFile", "multiSelections"],
    filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp"] }]
  });
  if (r.canceled || !r.filePaths || !r.filePaths.length) return { ok: true, canceled: true, images: list() };
  const images = list();
  const added = [];
  for (const fp of r.filePaths) {
    const ext = (path.extname(fp) || ".png").toLowerCase().replace(/^\./, "") || "png";
    const id = crypto.randomBytes(8).toString("hex");
    const filename = id + "." + ext;
    try {
      fs.copyFileSync(fp, path.join(dir(), filename));
    } catch (e) {
      logger.error("image-bank", "copy failed:", fp, e.message);
      continue;
    }
    const rec = { id, name: path.basename(fp), filename, size: fs.statSync(path.join(dir(), filename)).size, ts: Date.now() };
    images.push(rec);
    added.push(rec);
  }
  if (added.length) store.set({ [KEY]: images });
  return { ok: true, canceled: false, added, images };
}

function remove(id) {
  const images = list();
  const it = images.find((x) => x.id === id);
  if (!it) return false;
  try { fs.unlinkSync(path.join(dir(), it.filename)); } catch (e) {}
  store.set({ [KEY]: images.filter((x) => x.id !== id) });
  return true;
}

/** 读取图片为 dataURL（供 BOSS 页注入发送 / 面板预览） */
function readDataUrl(id) {
  const it = list().find((x) => x.id === id);
  if (!it) return null;
  try {
    const buf = fs.readFileSync(path.join(dir(), it.filename));
    const ext = path.extname(it.filename).slice(1);
    const mime = ({ png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", bmp: "image/bmp" })[ext] || "application/octet-stream";
    return { dataUrl: "data:" + mime + ";base64," + buf.toString("base64"), name: it.name, size: it.size };
  } catch (e) {
    logger.error("image-bank", "read failed:", id, e.message);
    return null;
  }
}

module.exports = { list, pick, remove, readDataUrl };
