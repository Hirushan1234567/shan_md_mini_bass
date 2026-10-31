// plugins/xvideos.js
// ─────────────────────────────────────────────────────────────
// XVIDEOS — Search + Download (Video / Document selection)
//
//   .xv <query> [page]      → search results (10 per page)
//   .xvdl <1-30>            → pick a result → bot asks: 1 Video / 2 Document
//   .xvdl <xvideos link>    → same, by link
//   .xvdl <1-30> vid|doc    → skip the question and send directly
//   (reply to a search list with a number) → same as .xvdl <number>
//   (reply to the format question with 1 / 2) → sends in that format
// ─────────────────────────────────────────────────────────────

import fs from "fs";
import path from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";

/* =========================
CONFIG
========================= */

const API_KEY = process.env.XV_API_KEY || "chama_api_aca7937aadbe4e84593bb8652f63d033";
const BASE_SEARCH = "https://api.chamindu.site/api/adult/xvideos/search";
const BASE_DL = "https://api.chamindu.site/api/adult/xvideos/dl";

const MAX_RESULTS = Number(process.env.XV_MAX_RESULTS || 30);
const CACHE_TTL = 30 * 60 * 1000;
const PENDING_TTL = 5 * 60 * 1000;
const SEARCH_TIMEOUT = 30000;
const DL_TIMEOUT = 60000;

const SEARCH_COMMANDS = ["xv", "xvideos", "xvsearch"];
const DL_COMMANDS = ["xvdl", "xvdownload"];

/* =========================
TEMP FOLDER
========================= */

const TMP_DIR = path.resolve(process.env.BOT_TMP_DIR || process.env.CINESUBZ_TMP_DIR || "./tmp");

try {
  fs.mkdirSync(TMP_DIR, { recursive: true });
  process.env.TMPDIR = TMP_DIR;
  process.env.TEMP = TMP_DIR;
  process.env.TMP = TMP_DIR;
} catch (error) {
  console.error("❌ xvideos tmp dir error:", error?.message || error);
}

/* =========================
STATE
========================= */

const store = {
  byMsg: new Map(), // search list message id -> { chat, items, time }
  lastByChat: new Map(), // chat -> { items, time }
  pending: new Map(), // format question message id -> { chat, item, time }
  busy: new Set()
};

function cleanCache() {
  const now = Date.now();
  for (const [id, e] of store.byMsg) if (now - e.time > CACHE_TTL) store.byMsg.delete(id);
  for (const [id, e] of store.lastByChat) if (now - e.time > CACHE_TTL) store.lastByChat.delete(id);
  for (const [id, e] of store.pending) if (now - e.time > PENDING_TTL) store.pending.delete(id);
  while (store.byMsg.size > 200) store.byMsg.delete(store.byMsg.keys().next().value);
  while (store.pending.size > 200) store.pending.delete(store.pending.keys().next().value);
}

/* =========================
HELPERS
========================= */

// හැම බොට් එකකටම වෙන වෙනම prefix (per-user settings)
async function getPrefix(sock) {
  try {
    const s = await globalThis.SHAN?.getSettings(sock?.botNumber);
    if (s?.prefix) return s.prefix;
  } catch {}
  return process.env.PREFIX || ".";
}

const say = (sock, msg, text) => sock.sendMessage(msg.key.remoteJid, { text }, { quoted: msg });

const react = async (sock, msg, emoji) => {
  try {
    await sock.sendMessage(msg.key.remoteJid, { react: { text: emoji, key: msg.key } });
  } catch {}
};

function safeName(name = "") {
  return String(name)
    .replace(/[\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
}

function stanzaIdOf(msg) {
  const m = msg?.message?.ephemeralMessage?.message || msg?.message;
  return (
    m?.extendedTextMessage?.contextInfo?.stanzaId ||
    m?.imageMessage?.contextInfo?.stanzaId ||
    ""
  );
}

async function getJson(url, timeout) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" }, signal: controller.signal });
    let data = null;
    try {
      data = await res.json();
    } catch {}
    if (!res.ok && !data) throw new Error(`HTTP ${res.status}`);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

const isXvUrl = v => /^https?:\/\/\S*xvideos\.\S+/i.test(String(v || ""));

/* =========================
SEND MEDIA (direct URL → fallback: download to server, then upload)
========================= */

const MAX_MB = Number(process.env.XV_MAX_MB || 800);

const shortReason = e => String(e?.message || e || "unknown error").replace(/\s+/g, " ").slice(0, 140);

async function downloadToTmp(link) {
  const file = path.join(TMP_DIR, `xv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.mp4`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10 * 60 * 1000);

  try {
    const res = await fetch(link, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0" }
    });
    if (!res.ok || !res.body) {
      let body = "";
      try { body = (await res.text()).replace(/\s+/g, " ").slice(0, 100); } catch {}
      throw new Error(`download HTTP ${res.status}${body ? `: ${body}` : ""}`);
    }

    const size = Number(res.headers.get("content-length") || 0);
    if (size && size > MAX_MB * 1024 * 1024) {
      const e = new Error(`file too large (${Math.round(size / 1048576)} MB)`);
      e.code = "TOO_LARGE";
      throw e;
    }

    await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(file));
    return file;
  } catch (error) {
    try { fs.unlinkSync(file); } catch {}
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function sendMedia(sock, from, msg, link, kind, caption, fileName) {
  const build = src =>
    kind === "video"
      ? { video: src, mimetype: "video/mp4", caption }
      : { document: src, fileName, mimetype: "video/mp4", caption };

  // 1) සෘජුවම URL එකෙන්
  try {
    await sock.sendMessage(from, build({ url: link }), { quoted: msg });
    return;
  } catch (error) {
    console.log(`xv: direct ${kind} send failed (${shortReason(error)}) — trying local download`);
  }

  // 2) Server එකට download කරලා upload කරනවා (වඩා විශ්වාසයි)
  let file = null;
  try {
    file = await downloadToTmp(link);
    await sock.sendMessage(from, build({ url: file }), { quoted: msg });
  } finally {
    if (file) {
      try { fs.unlinkSync(file); } catch {}
    }
  }
}

/* =========================
LINK INFO (thumbnail + title for pasted links)
========================= */

function decodeHtml(s = "") {
  return String(s)
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

async function scrapeMeta(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9"
      },
      signal: controller.signal
    });
    const html = await res.text();

    const pick = prop =>
      html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`, "i"))?.[1] ||
      html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${prop}["']`, "i"))?.[1] ||
      "";

    return {
      title: decodeHtml(pick("og:title")).replace(/\s*[-|]\s*XVIDEOS(\.COM)?\s*$/i, ""),
      thumbnail: decodeHtml(pick("og:image"))
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function apiMeta(url) {
  try {
    const data = await getJson(`${BASE_DL}?url=${encodeURIComponent(url)}&api_key=${API_KEY}`, 20000);
    if (!data?.success) return null;
    return {
      title: data.title || data.result?.title || "",
      thumbnail: data.thumbnail || data.thumb || data.image || data.result?.thumbnail || ""
    };
  } catch {
    return null;
  }
}

async function fetchLinkInfo(url) {
  const a = await scrapeMeta(url);
  if (a?.thumbnail && a?.title) return a;
  const b = await apiMeta(url);
  return {
    title: a?.title || b?.title || "",
    thumbnail: a?.thumbnail || b?.thumbnail || ""
  };
}

const VIDEO_WORDS = /^(1|vid|video|v)$/i;
const DOC_WORDS = /^(2|doc|document|d)$/i;

/* =========================
SEARCH
========================= */

async function runSearch(sock, msg, args, prefix) {
  const from = msg.key.remoteJid;

  let page = 1;
  let query = args.join(" ").trim();
  const last = args[args.length - 1];
  if (last && /^\d+$/.test(last) && args.length > 1) {
    page = parseInt(last, 10);
    query = args.slice(0, -1).join(" ").trim();
  }

  if (!query) {
    return say(
      sock,
      msg,
      `🎬 *XVIDEOS TOOLKIT*\n\n` +
        `🔎 Search : ${prefix}xv <query> [page]\n` +
        `📥 Download : ${prefix}xvdl <1-30>\n` +
        `🔗 By link : ${prefix}xvdl <xvideos link>\n` +
        `⚡ Direct : ${prefix}xvdl <1-30> vid  |  doc`
    );
  }

  await react(sock, msg, "🔎");

  let data;
  try {
    data = await getJson(
      `${BASE_SEARCH}?q=${encodeURIComponent(query)}&page=${page}&api_key=${API_KEY}`,
      SEARCH_TIMEOUT
    );
  } catch (error) {
    console.error("❌ xv search error:", error?.message || error);
    await react(sock, msg, "❌");
    return say(sock, msg, `❌ Search error: ${error?.message || "unknown error"}`);
  }

  if (!data?.success || !Array.isArray(data.results) || !data.results.length) {
    return say(sock, msg, data?.error ? `❌ ${data.error}` : `⚠️ No results for "${query}".`);
  }

  const items = data.results.slice(0, MAX_RESULTS).map(v => ({
    title: v.title || "Untitled",
    url: v.url,
    duration: v.duration || "",
    thumbnail: v.thumbnail || ""
  }));

  let text = `╭── 「 *XVIDEOS Search* 」\n│ 🔞 18+ only\n╰──────────────●●►\n\n`;
  text += `╭── 「 *SEARCH RESULTS* 」\n│ 🔎 Query: ${query}  (Page ${page})\n│\n`;
  items.forEach((v, i) => {
    const title = v.title.length > 80 ? `${v.title.slice(0, 77)}...` : v.title;
    text += `│ ${i + 1} ☞ ${title}${v.duration ? `  ⏱ ${v.duration}` : ""}\n│\n`;
  });
  text += `╰──────────────●●►\n\n`;
  text += `📌 Reply with the number to select.\n`;
  text += `➡️ Next page: ${prefix}xv ${query} ${page + 1}\n\n`;
  text += `_powered by SHAN MINI BOT_`;

  const sentIds = [];
  try {
    if (!items[0].thumbnail) throw new Error("no thumbnail");

    if (text.length <= 1000) {
      // කෙටි list එකක් → image + caption එකම message එකේ
      const s = await sock.sendMessage(from, { image: { url: items[0].thumbnail }, caption: text }, { quoted: msg });
      if (s?.key?.id) sentIds.push(s.key.id);
    } else {
      // දිග list එකක් → image එකක් + list එක text message එකක් ලෙස
      const s1 = await sock.sendMessage(
        from,
        { image: { url: items[0].thumbnail }, caption: `🔞 *XVIDEOS* — ${query}\n📄 Page ${page} • ${items.length} results` },
        { quoted: msg }
      );
      if (s1?.key?.id) sentIds.push(s1.key.id);
      const s2 = await say(sock, msg, text);
      if (s2?.key?.id) sentIds.push(s2.key.id);
    }
  } catch {
    const s = await say(sock, msg, text);
    if (s?.key?.id) sentIds.push(s.key.id);
  }

  cleanCache();
  const entry = { chat: from, items, time: Date.now() };
  store.lastByChat.set(from, entry);
  for (const id of sentIds) store.byMsg.set(id, entry);

  await react(sock, msg, "✅");
}

/* =========================
FORMAT QUESTION (1 Video / 2 Document)
========================= */

async function askFormat(sock, msg, item) {
  const from = msg.key.remoteJid;

  const text =
    `╭── 「 *SELECT FORMAT* 」\n` +
    `│ 🎬 ${item.title || "XVIDEOS"}\n` +
    (item.duration ? `│ ⏱ ${item.duration}\n` : "") +
    `│\n` +
    `│ 1 ☞ 🎞️ Video (playable)\n` +
    `│ 2 ☞ 📄 Document\n` +
    `╰──────────────●●►\n\n` +
    `📌 Reply to this message with *1* or *2*.`;

  let sent;
  try {
    if (!item.thumbnail) throw new Error("no thumbnail");
    sent = await sock.sendMessage(from, { image: { url: item.thumbnail }, caption: text }, { quoted: msg });
  } catch {
    sent = await say(sock, msg, text);
  }

  cleanCache();
  if (sent?.key?.id) {
    store.pending.set(sent.key.id, { chat: from, item, time: Date.now() });
  }
}

/* =========================
DOWNLOAD  (kind = "video" | "document")
========================= */

async function downloadVideo(sock, msg, url, title = "", kind = "document") {
  const from = msg.key.remoteJid;

  if (store.busy.has(from)) {
    return say(sock, msg, "⏳ A download is already running in this chat. Please wait until it finishes.");
  }
  store.busy.add(from);

  try {
    await react(sock, msg, "⏳");

    let data;
    try {
      data = await getJson(`${BASE_DL}?url=${encodeURIComponent(url)}&api_key=${API_KEY}`, DL_TIMEOUT);
    } catch (error) {
      console.error("❌ xv dl api error:", error?.message || error);
      await react(sock, msg, "❌");
      return say(sock, msg, `❌ API connection error: ${error?.message || "unknown error"}`);
    }

    if (!data?.success || !data.download_url) {
      await react(sock, msg, "❌");
      return say(sock, msg, `❌ Failed to process the download.\n${data?.error || "Unknown error"}`);
    }

    const sourceUrl = data.original_url || url;
    const fileName = `${safeName(title) || `XVIDEOS_${Date.now()}`}.mp4`;
    const caption = `🎬 ${title || "XVIDEOS DOWNLOAD"}\n\n🔗 Source: ${sourceUrl}`;

    const links = [...new Set([data.download_url, data.vps_download].filter(Boolean))];

    await say(sock, msg, kind === "video" ? "📤 Sending as video... please wait." : "📤 Sending as document... please wait.");

    let lastError = null;

    // ඉල්ලපු format එකෙන්ම විතරක් යවයි (video → video, document → document)
    for (const link of links) {
      try {
        await sendMedia(sock, from, msg, link, kind, caption, fileName);
        await react(sock, msg, "✅");
        return;
      } catch (error) {
        lastError = error;
        console.log(`xv: ${kind} send failed (${error?.message || error})`);
      }
    }

    const diskFull = lastError?.code === "ENOSPC" || /ENOSPC/i.test(lastError?.message || "");
    await react(sock, msg, "❌");
    return say(
      sock,
      msg,
      `⚠️ Could not send the file directly${diskFull ? " (the bot server's disk is full)" : ` (${shortReason(lastError)})`}.\n\n` +
        `🔗 Source: ${sourceUrl}\n` +
        `⬇️ Direct link: ${data.download_url}` +
        (data.raw_link ? `\n\n📎 Raw link: ${data.raw_link}` : "")
    );
  } finally {
    store.busy.delete(from);
  }
}

// "3" / "3 vid" / "3 doc" / "<link>" / "<link> doc"
async function handleDownloadInput(sock, msg, args, prefix) {
  const from = msg.key.remoteJid;

  const flag = args.find(a => /^(vid|video|v|doc|document|d)$/i.test(a));
  const kind = flag ? (VIDEO_WORDS.test(flag) ? "video" : "document") : null;
  const first = args.find(a => !/^(vid|video|v|doc|document|d)$/i.test(a)) || "";

  if (!first) {
    return say(
      sock,
      msg,
      `📥 Usage:\n${prefix}xvdl <1-30>  (from your last search)\n${prefix}xvdl <xvideos link>\n` +
        `Add *vid* or *doc* to skip the question: ${prefix}xvdl 3 vid`
    );
  }

  cleanCache();

  let item = null;

  if (isXvUrl(first)) {
    const known = store.lastByChat.get(from)?.items.find(x => x.url === first);
    item = known || { title: "", url: first, duration: "", thumbnail: "" };

    // Link එකක් paste කළාම thumbnail + title ගන්නවා
    if (!item.thumbnail || !item.title) {
      await react(sock, msg, "🔎");
      const info = await fetchLinkInfo(first);
      item = {
        ...item,
        title: item.title || info.title,
        thumbnail: item.thumbnail || info.thumbnail
      };
    }
  } else if (/^\D{0,3}\d{1,2}\D{0,6}$/.test(first)) {
    const entry = store.lastByChat.get(from);
    if (!entry) return say(sock, msg, `⚠️ No recent search in this chat.\nSearch first: ${prefix}xv <query>`);

    const n = parseInt(String(first).replace(/\D/g, ""), 10);
    item = entry.items[n - 1];
    if (!item) return say(sock, msg, `❌ Invalid number. Choose between 1 and ${entry.items.length}.`);
  } else {
    // අංකයක් / link එකක් නෙමෙයි නම් → නමක් ලෙස සලකා search කරයි (list එක යවයි)
    return runSearch(sock, msg, args.filter(a => !/^(vid|video|v|doc|document|d)$/i.test(a)), prefix);
  }

  if (kind) return downloadVideo(sock, msg, item.url, item.title, kind);
  return askFormat(sock, msg, item);
}

/* =========================
PLUGIN
========================= */

export default {
  commands: [...SEARCH_COMMANDS, ...DL_COMMANDS],

  premium: process.env.XV_PREMIUM_ONLY === "true",

  replyHandler: true,

  async execute(sock, msg, args, commandName) {
    const prefix = await getPrefix(sock);
    const name = String(commandName || "").toLowerCase();

    if (DL_COMMANDS.includes(name)) {
      return handleDownloadInput(sock, msg, args, prefix);
    }

    if (args[0] && isXvUrl(args[0])) {
      return handleDownloadInput(sock, msg, args, prefix);
    }

    return runSearch(sock, msg, args, prefix);
  },

  async handleReply(sock, msg, text) {
    const value = String(text || "").trim();
    const quotedId = stanzaIdOf(msg);
    const from = msg.key.remoteJid;

    /* ── Reply to the "Choose the format" question ── */
    const pend = store.pending.get(quotedId);
    if (pend) {
      if (pend.chat !== from) return false;

      if (Date.now() - pend.time > PENDING_TTL) {
        store.pending.delete(quotedId);
        await say(sock, msg, "⌛ This question has expired. Please select the video again.");
        return true;
      }

      let kind = null;
      if (VIDEO_WORDS.test(value)) kind = "video";
      else if (DOC_WORDS.test(value)) kind = "document";

      if (!kind) {
        await say(sock, msg, "❌ Reply *1* for Video or *2* for Document.");
        return true;
      }

      store.pending.delete(quotedId);

      try {
        await downloadVideo(sock, msg, pend.item.url, pend.item.title, kind);
      } catch (error) {
        console.error("❌ xv format reply error:", error?.stack || error?.message || error);
        await say(sock, msg, `❌ Something went wrong: ${error?.message || "unknown error"}`);
      }
      return true;
    }

    /* ── Reply to the search list with a number ── */
    const parsed = value.match(/^(\d{1,2})(?:\s*(vid|video|v|doc|document|d))?$/i);
    if (!parsed) return false;

    const entry = store.byMsg.get(quotedId);
    if (!entry || entry.chat !== from) return false;

    if (Date.now() - entry.time > CACHE_TTL) {
      store.byMsg.delete(quotedId);
      await say(sock, msg, "⌛ This list has expired. Please search again.");
      return true;
    }

    const item = entry.items[parseInt(parsed[1], 10) - 1];
    if (!item) {
      await say(sock, msg, `❌ Please send a number between 1 and ${entry.items.length}.`);
      return true;
    }

    try {
      if (parsed[2]) {
        const kind = VIDEO_WORDS.test(parsed[2]) ? "video" : "document";
        await downloadVideo(sock, msg, item.url, item.title, kind);
      } else {
        await askFormat(sock, msg, item);
      }
    } catch (error) {
      console.error("❌ xv reply error:", error?.stack || error?.message || error);
      await say(sock, msg, `❌ Something went wrong: ${error?.message || "unknown error"}`);
    }

    return true;
  }
};
