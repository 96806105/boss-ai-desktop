const logger = require("./logger");

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------
// 基础抓取
// ------------------------------------------------------------
async function fetchText(url, opts = {}) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": opts.ua || UA,
      "Accept-Language": "zh-CN,zh;q=0.9",
      "Accept": "text/html,application/xhtml+xml",
      ...(opts.headers || {})
    },
    signal: opts.signal || AbortSignal.timeout(15000)
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
// 技能词表（岗位库检索用）：从简历提取搜索关键词
// ------------------------------------------------------------
const SKILL_WORDS = [
  "python", "java", "go", "golang", "c++", "javascript", "前端", "后端", "全栈", "vue", "react", "node", "flutter", "android", "ios", "小程序",
  "算法", "机器学习", "深度学习", "nlp", "大模型", "ai", "数据分析", "sql", "excel", "tableau", "power bi", "etl", "爬虫", "自动化测试", "测试", "运维", "docker", "k8s", "云计算",
  "运营", "新媒体", "短视频", "抖音", "小红书", "直播", "电商", "淘宝", "天猫", "京东", "拼多多", "内容运营", "用户运营", "社群", "增长", "投放", "广告", "seo", "sem", "文案", "策划", "品牌", "公关", "活动",
  "销售", "客服", "商务", "采购", "供应链", "物流", "外贸", "跟单", "报关", "财务", "会计", "审计", "税务", "出纳", "法务", "合规", "hr", "人事", "招聘", "行政", "秘书", "助理",
  "设计", "ui", "ux", "平面设计", "剪辑", "ps", "ae", "pr", "摄影", "拍摄", "配音", "写作", "翻译", "英语", "日语", "韩语", "雅思", "六级", "四级",
  "金融", "保险", "证券", "基金", "医疗", "健康", "教育", "培训", "汽车", "新能源", "半导体", "芯片", "游戏", "快消", "制造", "房地产", "餐饮", "连锁", "旅游", "传媒", "娱乐"
];

/** 从简历文本提取技能关键词（命中技能词表，去重，按出现顺序） */
function extractResumeKeywords(resumeText) {
  const t = String(resumeText || "").toLowerCase();
  const found = [];
  const seen = new Set();
  for (const w of SKILL_WORDS) {
    const re = new RegExp(w.replace(/[+.]/g, "\\$&"), "g");
    if (re.test(t) && !seen.has(w)) {
      seen.add(w);
      found.push(w);
    }
  }
  return found.slice(0, 8);
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
    // 从 h3 之后抓取摘要：优先内容块 span，其次取第一个较长的文本段
    const after = String(html).slice(m.index + m[0].length, m.index + m[0].length + 3000);
    let snip = "";
    const spanM = after.match(/<span[^>]*class="[^"]*[Cc]ontent[^"]*"[^>]*>([\s\S]*?)<\/span>/);
    const divM = after.match(/<div[^>]*class="[^"]*(?:c-abstract|content-right|result-op)[^"]*"[^>]*>([\s\S]*?)<\/div>/);
    const raw = (spanM ? spanM[1] : "") + " " + (divM ? divM[1] : "");
    snip = stripTags(raw).slice(0, 300);
    if (!snip) {
      // 兜底：抓取该结果块内的文本（h3 后的 1200 字符去乱码）
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
// 字段抽取：从标题+摘要中提取结构化工商字段（多值投票 + 乱码清理）
// ------------------------------------------------------------
function cleanText(s) {
  return String(s || "").replace(/\uFFFD/g, "").replace(/\u2028|\u2029/g, " ").replace(/\s+/g, " ").trim();
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
      const val = cleanText(m[1] || m[2] || "");
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
    const html = await fetchText(url, { signal, headers: { Referer: "https://baike.baidu.com/", Accept: "text/html,application/xhtml+xml" }, ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0" });
    const titleM = html.match(/<title>([^<]+?) - 百度百科<\/title>/);
    const title = titleM ? stripTags(titleM[1]) : "";
    const fields = {};
    // 百科 infobox：<dt>字段</dt><dd>值</dd>（新样式 .basic-info 或 .J-basic-info）
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
    logger.warn("tools.baike", "fetch failed:", e.message);
    return null;
  }
}

// ------------------------------------------------------------
// 多引擎聚合：给定查询列表，并行检索并去重汇总
// ------------------------------------------------------------
async function multiSearch(queries, onProgress) {
  const results = [];
  const seen = new Set();
  const run = async ({ label, engines, q }) => {
    const engineList = Array.isArray(engines) ? engines : [engines];
    for (const engine of engineList) {
      try {
        const items = await searchEngine(engine, q);
        for (const it of items) {
          const key = it.title;
          if (seen.has(key)) continue;
          seen.add(key);
          results.push({ label, engine, title: it.title, href: it.href, snip: it.snip });
        }
        if (onProgress) onProgress(label, engine);
        if (items.length > 0) break; // 该查询有一个引擎出结果即可
      } catch (e) {
        logger.warn("tools.search", engine, "failed:", e.message);
      }
    }
  };
  await Promise.all(queries.map(run));
  return results;
}

const TOOLS = { webSearch: {
    name: "webSearch",
    description: "多引擎搜索（百度/搜狗/Bing）聚合公司相关信息，返回标题+摘要+来源。",
    params: { company: "string", keywords: "string(可选)" },
    async run({ company, keywords }) {
      const q = '"' + company + '"' + (keywords ? " " + keywords : "");
      const items = await multiSearch([
        { label: "general", engines: ["baidu", "bing"], q },
        { label: "extended", engines: ["sogou", "bing"], q: q + " 企业信息 工商" }
      ]);
      return items.slice(0, 12);
    }
  }
};

module.exports = { TOOLS, multiSearch, extractFields, fetchBaike, searchEngine, stripTags, SKILL_WORDS, extractResumeKeywords };