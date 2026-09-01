/**
 * WebIntelligenceSkill - 网络情报采集 Skill
 *
 * 从 tools.js 抽取的搜索引擎采集能力，提供：
 * - 单引擎搜索（百度/搜狗/Bing）
 * - 多引擎聚合搜索
 * - 结构化字段抽取（工商信息）
 * - 百度百科抓取
 */
const { SkillBase } = require("../skill-base");
const logger = require("../../core/logger");

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------
// 基础抓取
// ------------------------------------------------------------
async function fetchText(url, opts = {}) {
  const outer = opts.signal || null;
  const timeout = AbortSignal.timeout(15000);
  const abort = outer && !outer.aborted ? AbortSignal.any([outer, timeout]) : timeout;
  const res = await fetch(url, {
    headers: {
      "User-Agent": opts.ua || UA,
      "Accept-Language": "zh-CN,zh;q=0.9",
      "Accept": "text/html,application/xhtml+xml",
      ...(opts.headers || {})
    },
    signal: abort
  });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.text();
}

function stripTags(s) {
  return (s || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ").replace(/&ensp;/g, " ").replace(/&#0183;/g, "·")
    .replace(/\s+/g, " ").trim();
}

// ------------------------------------------------------------
// 引擎解析器
// ------------------------------------------------------------
function parseBing(html) {
  const out = [];
  const blocks = String(html || "").split('<li class="b_algo"');
  for (let i = 1; i < blocks.length; i++) {
    const b = blocks[i];
    const mHref = b.match(/<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/h2>/);
    if (!mHref) continue;
    const href = mHref[1];
    const title = stripTags(mHref[2]);
    const mSnip = b.match(/<p[^>]*>([\s\S]*?)<\/p>/);
    const snip = mSnip ? stripTags(mSnip[1]).slice(0, 300) : "";
    if (title && !/bing\.com\/|microsoft\.com/i.test(href)) out.push({ title, href, snip });
    if (out.length >= 8) break;
  }
  return out;
}

function parseBaidu(html) {
  const out = [];
  const seen = new Set();
  const re = /<h3[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/h3>/g;
  let m;
  while ((m = re.exec(String(html || ""))) && out.length < 8) {
    const href = m[1];
    const title = stripTags(m[2]);
    if (!title || seen.has(title)) continue;
    seen.add(title);
    const after = String(html).slice(m.index + m[0].length, m.index + m[0].length + 3000);
    let snip = "";
    const spanM = after.match(/<span[^>]*class="[^"]*[Cc]ontent[^"]*"[^>]*>([\s\S]*?)<\/span>/);
    const divM = after.match(/<div[^>]*class="[^"]*(?:c-abstract|content-right|result-op)[^"]*"[^>]*>([\s\S]*?)<\/div>/);
    const raw = (spanM ? spanM[1] : "") + " " + (divM ? divM[1] : "");
    snip = stripTags(raw).slice(0, 300);
    if (!snip) {
      const blockTxt = stripTags(String(html).slice(m.index + m[0].length, m.index + m[0].length + 1800));
      snip = blockTxt.replace(/^[\s·]*/, "").slice(0, 220);
    }
    if (!/^https?:\/\/www\.baidu\.com\/?$/.test(href) && !/baijiahao.*百度快照/.test(snip)) {
      out.push({ title, href, snip });
    }
  }
  return out;
}

function parseSogou(html) {
  const out = [];
  const re = /<h3[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/h3>/g;
  let m;
  while ((m = re.exec(String(html || ""))) && out.length < 8) {
    const title = stripTags(m[2]);
    if (!title) continue;
    const after = String(html).slice(m.index + m[0].length, m.index + m[0].length + 2000);
    const snipM = after.match(/<div[^>]*class="[^"]*(?:text-layout|space-txt|str-text|fz-mid)[^"]*"[^>]*>([\s\S]*?)<\/div>/);
    const snip = snipM ? stripTags(snipM[1]).slice(0, 300) : "";
    if (!/sogou\.com/.test(m[1])) out.push({ title, href: m[1], snip });
  }
  return out;
}

// ------------------------------------------------------------
// 引擎查询（带随机间隔，规避风控）
// ------------------------------------------------------------
async function searchEngine(kind, q, signal) {
  if (kind === "baidu") {
    await sleepMs(300 + Math.random() * 400);
    const html = await fetchText("https://www.baidu.com/s?wd=" + encodeURIComponent(q) + "&rn=10", { signal });
    if (html.includes("百度安全验证") || html.length < 10000) return [];
    return parseBaidu(html);
  }
  if (kind === "sogou") {
    await sleepMs(200 + Math.random() * 300);
    const html = await fetchText("https://www.sogou.com/web?query=" + encodeURIComponent(q), { signal });
    if (html.includes("请输入验证码") || html.length < 10000) return [];
    return parseSogou(html);
  }
  // bing
  await sleepMs(200 + Math.random() * 300);
  const html = await fetchText("https://www.bing.com/search?q=" + encodeURIComponent(q) + "&setlang=zh-hans&count=10", { signal });
  return parseBing(html);
}

// ------------------------------------------------------------
// 字段抽取
// ------------------------------------------------------------
function cleanText(s) {
  return String(s || "").replace(/\uFFFD/g, "").replace(/\u2028|\u2029/g, " ").replace(/\s+/g, " ").trim();
}

function normFieldVal(v) {
  return String(v || "")
    .replace(/([\d,.]+亿)(?:元|人民币)/, "$1")
    .replace(/([\d,.]+万)(?:元|人民币)/, "$1")
    .trim();
}

function extractFields(texts) {
  const all = texts.map(cleanText).join("\n");
  const F = {};
  const rules = [
    [/注册资本\s*[:：]?\s*([\d,.]+(?:万|亿)?(?:元|美元|港元)?(?:人民币)?)/i, "注册资本"],
    [/实缴(?:资本)?\s*[:：]?\s*([\d,.]+(?:万|亿)?(?:元|人民币)?)/i, "实缴资本"],
    [/成立(?:时间|日期)?\s*[:：]?\s*(\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日|\d{4}\s*[-/.]\s*\d{1,2}\s*[-/.]\s*\d{1,2}|\d{4}\s*年)/i, "成立时间"],
    [/法定代表(?:人)?\s*[:：]\s*([\u4e00-\u9fa5]{2,4})/, "法定代表人"],
    [/(?:统一社会信用代码|信用代码|注册号)\s*[:：]?\s*([0-9A-Za-z]{15,18})/i, "信用代码"],
    [/参保人数\s*[:：]?\s*(\d+(?:人)?)/i, "参保人数"],
    [/经营状态\s*[:：]?\s*([\u4e00-\u9fa5]{2,10})/, "经营状态"],
    [/员工(?:人数|规模)\s*[:：]?\s*(\d+(?:人)?)/i, "员工规模"],
    [/(?:A股代码|证券代码)?[（(]?(\d{6})[）)][：:]?\s*[\u4e00-\u9fa5A-Za-z]*(?:股|A股)?|股票代码\s*[:：]?\s*(\d{6})/i, "股票代码"]
  ];
  for (const [re, name] of rules) {
    const votes = {};
    let m;
    const re2 = new RegExp(re.source, re.flags.replace("g", "") + "g");
    while ((m = re2.exec(all))) {
      const val = normFieldVal(cleanText(m[1] || m[2] || ""));
      if (!val) continue;
      votes[val] = (votes[val] || 0) + 1;
    }
    const entries = Object.entries(votes).sort((a, b) => b[1] - a[1]);
    if (entries.length) F[name] = { value: entries[0][0], count: entries[0][1], candidates: entries.map((e) => e[0]) };
  }
  return F;
}

// ------------------------------------------------------------
// 百度百科 infobox 抓取
// ------------------------------------------------------------
async function fetchBaike(url, signal) {
  try {
    if (!/baike\.baidu\.com\/item/.test(url)) return null;
    const html = await fetchText(url, {
      signal,
      headers: { Referer: "https://baike.baidu.com/", Accept: "text/html,application/xhtml+xml" },
      ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0"
    });
    const titleM = html.match(/<title>([^<]+?) - 百度百科<\/title>/);
    const title = titleM ? stripTags(titleM[1]) : "";
    const fields = {};
    const blockM = html.match(/<dl[^>]*class="[^"]*basic-info[^"]*"[^>]*>([\s\S]*?)<\/dl>/);
    const block = blockM ? blockM[1] : html;
    const dtRe = /<dt[^>]*>([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/g;
    let m;
    while ((m = dtRe.exec(block)) && Object.keys(fields).length < 20) {
      const k = stripTags(m[1]);
      const v = stripTags(m[2]).slice(0, 120);
      if (k && v && /注册资本|成立|法定代表|注册|经营|员工|实缴|上市|总部|统一|信用/.test(k)) fields[k] = v;
    }
    return { title, fields, url };
  } catch (e) {
    logger.warn("web-intelligence", "fetchBaike failed:", e.message);
    return null;
  }
}

// ------------------------------------------------------------
// 多引擎聚合
// ------------------------------------------------------------
async function multiSearch(queries, onProgress, signal) {
  const results = [];
  const seen = new Set();
  const run = async ({ label, engines, q }) => {
    const engineList = Array.isArray(engines) ? engines : [engines];
    for (const engine of engineList) {
      if (signal && signal.aborted) throw new Error("任务已取消");
      try {
        const items = await searchEngine(engine, q, signal);
        for (const it of items) {
          const key = it.title;
          if (seen.has(key)) continue;
          seen.add(key);
          results.push({ label, engine, title: it.title, href: it.href, snip: it.snip });
        }
        if (onProgress) onProgress(label, engine);
        if (items.length > 0) break;
      } catch (e) {
        logger.warn("web-intelligence", engine, "failed:", e.message);
      }
    }
  };
  await Promise.all(queries.map(run));
  return results;
}

/**
 * WebIntelligenceSkill - 网络情报采集
 */
class WebIntelligenceSkill extends SkillBase {
  constructor(manifest) {
    super(manifest);

    // 注册工具
    this.registerTool("search", async (input, ctx) => {
      const { engine, query } = input;
      return searchEngine(engine, query, ctx.signal);
    });

    this.registerTool("multiSearch", async (input, ctx) => {
      const { queries, onProgress } = input;
      return multiSearch(queries, onProgress, ctx.signal);
    });

    this.registerTool("extractFields", async (input) => {
      const { texts } = input;
      return extractFields(texts);
    });

    this.registerTool("fetchBaike", async (input, ctx) => {
      const { url } = input;
      return fetchBaike(url, ctx.signal);
    });
  }
}

module.exports = { WebIntelligenceSkill, searchEngine, multiSearch, extractFields, fetchBaike, stripTags };
