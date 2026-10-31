// plugins/cartoonslk.js
// SHAN MINI BOT V1 — cartoons.lk (Sinhala dubbed cartoons / movies / series)
//
//   .clk <name>                → search results (reply a number)
//   .clk <cartoons.lk link>    → details of that page
//   .clklatest [page]          → latest uploads
//   .clkcat <slug> [page]      → a category (example: .clkcat cartoons)
//   .clktest                   → API check (owner only)
//
// (cartoon.js keeps .cartoon / .cartoons / .cartoonlist — these names do not clash)
//
// FLOW (everything is a number reply):
//   list  → reply a number            → details card + episode list
//   list  → reply "next" / "prev"     → another page
//   episodes → reply an episode number → download options
//   downloads → reply a number         → file is downloaded and sent
//                 "2" = document (default)   "2 vid" = playable video
//
// APIs (supunofc.site): search / latest / category / details.
// The download endpoint name is not in the API docs we have, so the plugin tries a list of
// likely names (DL_CANDIDATES) and remembers the one that works. If you know the real
// endpoint, set CARTOONSLK_DL_URL in .env (template, see fillTemplate placeholders).
//
// Optional .env: SUPUN_API_KEY, CARTOONSLK_DL_URL, CARTOONSLK_MAX_MB (default 2000),
//                CARTOONSLK_SEND_MODE=video|document

import fs from "fs";
import path from "path";
import { Readable, Transform } from "stream";
import { pipeline } from "stream/promises";
import mongoose from "mongoose";

/* =====================================================
CONFIG
===================================================== */

const BASE = "https://supunofc.site/api/cartoon/cartoonslk";
const API_KEY = process.env.SUPUN_API_KEY || "supun_af8911b597c7165c2bbadbf42ed97bae";

// Optional template from .env — placeholders: {url} page link · {postId} · {index} episode index
//   · {number} episode number · {linkIndex} · {provider} · {label} · {apikey}
const DL_TEMPLATE = process.env.CARTOONSLK_DL_URL || "";

// Endpoint names tried (in this order) until one answers with a file link
const DL_CANDIDATES = [
  "download", "dl", "downloadlink", "download-link", "link", "links", "getlink", "get-link",
  "episode", "episode/download", "episode-download", "resolve", "direct", "file", "media", "fetch"
];

let knownEndpoint = ""; // learned automatically

const COMMANDS = ["clk", "cartoonslk"];
const LATEST_COMMANDS = ["clklatest"];
const CATEGORY_COMMANDS = ["clkcat"];
const TEST_COMMANDS = ["clktest"];

const ALL_COMMANDS = [...COMMANDS, ...LATEST_COMMANDS, ...CATEGORY_COMMANDS, ...TEST_COMMANDS];

const MAX_SHOW = 15;
const MAX_MB = Number(process.env.CARTOONSLK_MAX_MB || 2000);
const CACHE_TTL = 30 * 60 * 1000;
const API_TIMEOUT = 30000;
const DEFAULT_SEND_MODE = process.env.CARTOONSLK_SEND_MODE === "video" ? "video" : "document";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const TMP_DIR = path.resolve(process.env.BOT_TMP_DIR || process.env.CINESUBZ_TMP_DIR || "./tmp");

try {
  fs.mkdirSync(TMP_DIR, { recursive: true });
  process.env.TMPDIR = TMP_DIR;
  process.env.TEMP = TMP_DIR;
  process.env.TMP = TMP_DIR;
} catch (error) {
  console.error("❌ cartoonslk tmp dir error:", error?.message || error);
}

function cleanTempDir() {
  try {
    const now = Date.now();

    for (const file of fs.readdirSync(TMP_DIR)) {
      if (!file.startsWith("cartoonslk_")) continue;

      const full = path.join(TMP_DIR, file);

      try {
        const st = fs.statSync(full);

        if (st.isFile() && now - st.mtimeMs > 10 * 60 * 1000) fs.rmSync(full, { force: true });
      } catch {}
    }
  } catch {}
}

function freeDiskMB(dir) {
  try {
    const st = fs.statfsSync(dir);

    return (st.bavail * st.bsize) / (1024 * 1024);
  } catch {
    return null;
  }
}

cleanTempDir();

/* =====================================================
STATE (reply lists) — key = id of the message the bot sent
===================================================== */

const store = new Map();
const busy = new Set();

function cleanCache() {
  const now = Date.now();

  for (const [id, entry] of store) {
    if (now - entry.time > CACHE_TTL) store.delete(id);
  }

  while (store.size > 300) store.delete(store.keys().next().value);
}

function remember(sent, entry) {
  cleanCache();

  if (sent?.key?.id) store.set(sent.key.id, { ...entry, time: Date.now() });
}

/* =====================================================
SMALL HELPERS
===================================================== */

const say = (sock, msg, text) =>
  sock.sendMessage(msg.key.remoteJid, { text }, { quoted: msg });

async function react(sock, msg, emoji) {
  try {
    await sock.sendMessage(msg.key.remoteJid, { react: { text: emoji, key: msg.key } });
  } catch {}
}

async function getPrefix() {
  try {
    const s = await globalThis.SHAN_GET_SETTINGS?.();

    if (s?.prefix) return s.prefix;
  } catch {}

  return process.env.PREFIX || ".";
}

function stanzaIdOf(msg) {
  const m = msg?.message?.ephemeralMessage?.message || msg?.message;

  return (
    m?.extendedTextMessage?.contextInfo?.stanzaId ||
    m?.imageMessage?.contextInfo?.stanzaId ||
    ""
  );
}

function safeName(name = "") {
  return (
    String(name)
      .replace(/[\\/:*?"<>|]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120) || "cartoon"
  );
}

// "Ben 10 ... Cartoon | සිංහල හඩකැවූ බෙන් ටෙන්" → English part only
const shortTitle = title => String(title || "").split("|")[0].trim() || String(title || "");

function parseSizeMB(size = "") {
  const m = String(size).match(/([\d.]+)\s*(GB|MB|KB)/i);

  if (!m) return 0;

  const n = parseFloat(m[1]);
  const unit = m[2].toUpperCase();

  return unit === "GB" ? n * 1024 : unit === "MB" ? n : n / 1024;
}

const isCartoonsUrl = value => /^https?:\/\/(?:www\.)?cartoons\.lk\//i.test(String(value || ""));

const isOwner = msg => Boolean(globalThis.SHAN_IS_OWNER_MSG?.(msg));

// If a command of this plugin was made Premium-only, replies must be protected too
async function replyAllowed(sock, msg) {
  try {
    if (mongoose.connection.readyState !== 1) return true;

    const doc = await mongoose.connection
      .collection("premiumsettings")
      .findOne({ _id: "premium_commands" });

    const list = (doc?.commands || []).map(c => String(c).toLowerCase());

    if (!ALL_COMMANDS.some(c => list.includes(c))) return true;

    return typeof globalThis.SHAN_IS_PREMIUM === "function"
      ? Boolean(await globalThis.SHAN_IS_PREMIUM(sock, msg))
      : true;
  } catch {
    return true;
  }
}

/* =====================================================
API
===================================================== */

async function fetchApi(endpoint, params = {}) {
  const query = new URLSearchParams({ ...params, apikey: API_KEY });
  const url = `${BASE}/${endpoint}?${query.toString()}`;

  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(API_TIMEOUT)
  });

  const text = await res.text();
  let json = null;

  try {
    json = JSON.parse(text);
  } catch {}

  if (!res.ok && !json) throw new Error(`API HTTP ${res.status}`);
  if (!json) throw new Error("The API returned an invalid response");
  if (json.success === false) throw new Error(json.error || json.message || "The API reported an error");

  return json;
}

function normalizeList(json) {
  const r = json?.result || {};

  return {
    items: (r.results || [])
      .filter(x => x?.url && x?.title)
      .slice(0, MAX_SHOW)
      .map(x => ({
        title: x.title,
        url: x.url,
        date: x.date || "",
        image: x.image || ""
      })),
    page: Number(r.page) || 1,
    totalPages: Number(r.totalPages) || 1,
    hasNext: Boolean(r.hasNext),
    hasPrevious: Boolean(r.hasPrevious)
  };
}

// source = { kind: "search" | "latest" | "category", q?, slug?, page }
async function fetchList(source) {
  const page = source.page > 1 ? { page: String(source.page) } : {};

  if (source.kind === "search") return normalizeList(await fetchApi("search", { q: source.q, ...page }));
  if (source.kind === "latest") return normalizeList(await fetchApi("latest", page));

  return normalizeList(await fetchApi("category", { slug: source.slug, ...page }));
}

function normalizeDownload(d, extra = {}) {
  return {
    label: d?.label || "",
    fileSize: d?.fileSize || "",
    provider: String(d?.provider || "").toLowerCase(),
    linkIndex: d?.linkIndex ?? 0,
    postId: d?.postId ?? extra.postId ?? "",
    index: extra.index ?? ""
  };
}

async function fetchDetails(url) {
  const json = await fetchApi("details", { url });
  const r = json?.result;

  if (!r?.title) throw new Error("Details API returned an invalid response");

  const episodes = (r.episodes || []).map((e, i) => ({
    number: e.number ?? String(i + 1),
    title: e.title || `Episode ${e.number ?? i + 1}`,
    fileSize: e.fileSize || "",
    downloads: (e.downloads || []).map(d =>
      normalizeDownload(d, { postId: e.postId, index: e.index ?? i })
    )
  }));

  return {
    url: r.url || url,
    title: r.title,
    date: r.date || "",
    image: r.image || "",
    categories: (r.categories || []).map(c => c?.name).filter(Boolean),
    description: Array.isArray(r.description) ? r.description.join(" ") : String(r.description || ""),
    episodes,
    downloads: (r.downloads || []).map(d => normalizeDownload(d, { postId: r.postId, index: "" }))
  };
}

/* ---------- download link ---------- */

function fillTemplate(template, values) {
  return template.replace(/\{(\w+)\}/g, (_, key) => encodeURIComponent(String(values[key] ?? "")));
}

// finds a file link anywhere in the API's JSON
function extractLink(json, skip = []) {
  const preferred = /^(url|link|download|downloadurl|download_url|direct|directurl|direct_url|file|src)$/i;
  let fallback = "";

  const walk = (value, key = "") => {
    if (typeof value === "string") {
      if (/^https?:\/\//i.test(value) && !skip.some(s => s && value.includes(s))) {
        if (preferred.test(key)) return value;
        if (!fallback) fallback = value;
      }

      return "";
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        const found = walk(item, key);

        if (found) return found;
      }

      return "";
    }

    if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) {
        const found = walk(v, k);

        if (found) return found;
      }
    }

    return "";
  };

  return walk(json) || fallback;
}

function dlParams(entry, item) {
  const values = {
    url: entry.pageUrl,
    postId: item.postId,
    post_id: item.postId,
    index: item.index,
    episodeIndex: item.index,
    episode: entry.number ?? "",
    linkIndex: item.linkIndex,
    link_index: item.linkIndex,
    provider: item.provider,
    apikey: API_KEY
  };

  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(values)) {
    if (value !== "" && value !== undefined && value !== null) query.set(key, String(value));
  }

  return query;
}

async function callDownloadApi(endpoint, entry, item, timeout = 30000) {
  const url = `${BASE}/${endpoint}?${dlParams(entry, item).toString()}`;

  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(timeout)
  });

  const text = await res.text();
  let json = null;

  try {
    json = JSON.parse(text);
  } catch {}

  const notFound = /API endpoint not found/i.test(json?.message || "") || /API endpoint not found/i.test(text);
  const failed = !json || json.success === false || json.status === false;
  const link = !failed ? extractLink(json, [entry.pageUrl, API_KEY]) : "";

  return { endpoint, status: res.status, notFound, link, text };
}

const redactKey = text => String(text).split(API_KEY).join("***");

async function resolveDownloadLink(entry, item) {
  /* 1) custom template from .env */
  if (DL_TEMPLATE) {
    const apiUrl = fillTemplate(DL_TEMPLATE, {
      url: entry.pageUrl,
      postId: item.postId,
      index: item.index,
      number: entry.number ?? "",
      linkIndex: item.linkIndex,
      provider: item.provider,
      label: item.label,
      apikey: API_KEY
    });

    const res = await fetch(apiUrl, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: AbortSignal.timeout(60000)
    });

    const text = await res.text();
    let json = null;

    try {
      json = JSON.parse(text);
    } catch {}

    if (!json || json.success === false || json.status === false) {
      console.error(`[CARTOONSLK] download API (HTTP ${res.status}):`, redactKey(text).slice(0, 300));
      throw new Error(json?.message || json?.error || `Download API error (HTTP ${res.status})`);
    }

    const link = extractLink(json, [entry.pageUrl, API_KEY]);

    if (!link) throw new Error("The download API did not return a file link");

    return link;
  }

  /* 2) automatic: try the known endpoint, otherwise the candidate names */
  const order = knownEndpoint
    ? [knownEndpoint, ...DL_CANDIDATES.filter(name => name !== knownEndpoint)]
    : DL_CANDIDATES;
  let lastReal = null;

  for (const endpoint of order) {
    let result;

    try {
      result = await callDownloadApi(endpoint, entry, item);
    } catch (error) {
      console.log(`[CARTOONSLK] ${endpoint}: ${error?.message || error}`);
      continue;
    }

    if (result.notFound) continue;

    if (result.link) {
      if (knownEndpoint !== endpoint) console.log(`[CARTOONSLK] download endpoint found: ${endpoint}`);

      knownEndpoint = endpoint;

      return result.link;
    }

    console.error(`[CARTOONSLK] ${endpoint} (HTTP ${result.status}):`, redactKey(result.text).slice(0, 300));
    lastReal = result;

    // the learned endpoint answered but gave no link for this file — don't scan the others
    if (endpoint === knownEndpoint) break;
  }

  if (!lastReal) knownEndpoint = ""; // every name said "not found" — learn again next time

  if (lastReal) {
    throw new Error(
      `Download API "${lastReal.endpoint}" answered HTTP ${lastReal.status}: ${redactKey(lastReal.text).replace(/\s+/g, " ").slice(0, 160)}`
    );
  }

  throw new Error("No working download endpoint was found. Run the clktest command and send me its result.");
}

/* =====================================================
MESSAGE BUILDERS
===================================================== */

function sourceTitle(source) {
  if (source.kind === "search") return `🔎 Search: ${source.q}`;
  if (source.kind === "latest") return "🆕 Latest uploads";

  return `📂 Category: ${source.slug}`;
}

function buildList(source, data) {
  let text = `🎬 *CARTOONS.LK*\n${sourceTitle(source)}\n📄 Page ${data.page}/${data.totalPages}\n\n`;

  data.items.forEach((item, i) => {
    text += `*${i + 1}.* ${shortTitle(item.title)}\n`;
    if (item.date) text += `     📅 ${item.date}\n`;
    text += "\n";
  });

  text += `📩 *Reply* with a number to open it (1 - ${data.items.length})`;
  if (data.hasNext) text += `\n➡️ Reply *next* for the next page`;
  if (data.hasPrevious) text += `\n⬅️ Reply *prev* for the previous page`;

  return text;
}

function buildDetailsCard(d) {
  const lines = [`🎬 *${d.title}*`, ""];

  if (d.date) lines.push(`📅 Date : ${d.date}`);
  if (d.categories.length) lines.push(`🏷️ Category : ${d.categories.join(", ")}`);
  if (d.episodes.length) lines.push(`📺 Episodes : ${d.episodes.length}`);

  if (d.description) {
    const text = d.description.replace(/\s+/g, " ").trim();

    lines.push("", `📝 ${text.length > 300 ? `${text.slice(0, 299)}…` : text}`);
  }

  return lines.join("\n");
}

function buildEpisodeList(d) {
  const eps = d.episodes.slice(0, 99);

  let text = `📺 *CARTOONS.LK EPISODES*\n🎞️ ${shortTitle(d.title)}\n\n`;

  eps.forEach((e, i) => {
    text += `*${i + 1}.* ${e.title}${e.fileSize ? `  •  ${e.fileSize}` : ""}\n`;
  });

  text += `\n📩 *Reply* with an episode number (1 - ${eps.length})`;

  return { text, items: eps };
}

function providerLabel(provider) {
  if (provider === "r2") return "🚀 Direct server";
  if (provider === "gdrive") return "☁️ Google Drive (link only)";

  return `📦 ${provider || "Server"}`;
}

function buildDownloadList(title, downloads) {
  // direct servers first
  const items = [...downloads]
    .sort((a, b) => (a.provider === "gdrive" ? 1 : 0) - (b.provider === "gdrive" ? 1 : 0))
    .slice(0, 99);

  if (!items.length) {
    return { text: `📥 *CARTOONS.LK DOWNLOADS*\n🎞️ ${title}\n\n😕 No download links were found.`, items: [] };
  }

  let text = `📥 *CARTOONS.LK DOWNLOADS*\n🎞️ ${title}\n\n`;

  items.forEach((it, i) => {
    const head = [it.label, it.fileSize].filter(Boolean).join(" • ");
    const tooBig = parseSizeMB(it.fileSize) > MAX_MB;

    text += `*${i + 1}.* ${head || "File"}\n     ${tooBig ? "🔗 Too big for WhatsApp (link only)" : providerLabel(it.provider)}\n`;
  });

  text += `\n📩 *Reply* with a number to download (1 - ${items.length})`;
  text += `\n📄 Default: *document*   🎞️ Playable video: reply like *1 vid*`;

  return { text, items };
}

/* =====================================================
POSTER
===================================================== */

async function getPoster(url) {
  try {
    if (!url) return null;

    const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15000) });

    if (!res.ok) return null;

    const buffer = Buffer.from(await res.arrayBuffer());

    try {
      // cartoons.lk posters are .webp — convert to JPEG so WhatsApp shows them as a normal image
      const sharp = (await import("sharp")).default;

      return await sharp(buffer).jpeg({ quality: 85 }).toBuffer();
    } catch {
      return /\.(jpe?g|png)(\?|$)/i.test(url) ? buffer : null;
    }
  } catch {
    return null;
  }
}

/* =====================================================
DOWNLOAD ENGINE
===================================================== */

async function downloadToTemp(url, file, maxMB) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "*/*" },
    redirect: "follow"
  });

  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

  if (/text\/html/i.test(res.headers.get("content-type") || "")) {
    throw new Error("The server returned a web page instead of a file (the link may have expired)");
  }

  const maxBytes = maxMB * 1024 * 1024;
  const length = Number(res.headers.get("content-length") || 0);

  if (length && length > maxBytes) {
    const e = new Error("File too large");
    e.tooBig = true;
    throw e;
  }

  let received = 0;

  const limiter = new Transform({
    transform(chunk, _enc, cb) {
      received += chunk.length;

      if (received > maxBytes) {
        const e = new Error("File too large");
        e.tooBig = true;
        return cb(e);
      }

      cb(null, chunk);
    }
  });

  await pipeline(Readable.fromWeb(res.body), limiter, fs.createWriteStream(file));

  return received;
}

async function downloadItem(sock, msg, entry, item, mode) {
  const from = msg.key.remoteJid;

  if (busy.has(from)) {
    return say(sock, msg, "⏳ A download is already running in this chat. Please wait until it finishes.");
  }

  busy.add(from);

  try {
    await react(sock, msg, "⏳");

    if (parseSizeMB(item.fileSize) > MAX_MB) {
      return say(sock, msg, `⚠️ This file is too big (${item.fileSize}) to send on WhatsApp.\n\n🌐 Open the page:\n${entry.pageUrl}`);
    }

    let link;

    try {
      link = await resolveDownloadLink(entry, item);
    } catch (error) {
      await react(sock, msg, "❌");

      return say(
        sock,
        msg,
        `❌ Could not get the download link.\n${error?.message || ""}\n\n🌐 Open the page and download there:\n${entry.pageUrl}`
      );
    }

    // Google Drive links can't be fetched directly — give the link instead
    if (item.provider === "gdrive" || /drive\.google\.com|docs\.google\.com/i.test(link)) {
      await react(sock, msg, "✅");

      return say(sock, msg, `☁️ Google Drive link (open it in your browser):\n\n🔗 ${link}`);
    }

    let urlName = "";

    try {
      urlName = decodeURIComponent(link.split("?")[0].split("/").pop() || "");
    } catch {}

    const ext = (urlName.match(/\.(mp4|mkv|avi|webm)$/i)?.[1] || "mp4").toLowerCase();
    const mimetype = ext === "mkv" ? "video/x-matroska" : ext === "webm" ? "video/webm" : "video/mp4";
    const fileName = `${safeName(entry.title)}.${ext}`;

    await say(sock, msg, `📤 *${entry.title}*\n⏳ Downloading... this can take a few minutes.`);

    cleanTempDir();

    const needMB = parseSizeMB(item.fileSize) * 2.1;
    const freeMB = freeDiskMB(TMP_DIR);

    if (freeMB !== null && needMB && freeMB < needMB) {
      await react(sock, msg, "❌");

      return say(
        sock,
        msg,
        `❌ Not enough free disk space on the bot server.\n\n💾 Free : ${Math.round(freeMB)} MB\n📦 Needed : about ${Math.round(needMB)} MB\n\nDirect link:\n🔗 ${link}`
      );
    }

    const tmpFile = path.join(TMP_DIR, `cartoonslk_${Date.now()}.${ext}`);

    try {
      await downloadToTemp(link, tmpFile, MAX_MB);

      const caption =
        `🎬 ${entry.title}` +
        (item.label || item.fileSize ? `\n💿 ${[item.label, item.fileSize].filter(Boolean).join(" • ")}` : "");

      if (mode === "video" && ext === "mp4") {
        await sock.sendMessage(from, { video: { url: tmpFile }, mimetype: "video/mp4", fileName, caption }, { quoted: msg });
      } else {
        await sock.sendMessage(from, { document: { url: tmpFile }, mimetype, fileName, caption }, { quoted: msg });
      }

      await react(sock, msg, "✅");
    } catch (error) {
      console.error("❌ cartoonslk download error:", error?.message || error);

      const diskFull = error?.code === "ENOSPC" || /ENOSPC/i.test(error?.message || "");
      const reason = error?.tooBig
        ? "The file is too big."
        : diskFull
        ? "The bot server's disk is full."
        : `Download / upload failed (${error?.message || "unknown error"}).`;

      await react(sock, msg, "❌");
      await say(sock, msg, `❌ ${reason}\n\nDirect link:\n🔗 ${link}`);
    } finally {
      try {
        fs.rmSync(tmpFile, { force: true });
      } catch {}
    }
  } finally {
    busy.delete(from);
  }
}

/* =====================================================
FLOWS
===================================================== */

async function sendList(sock, msg, source) {
  await react(sock, msg, "🔎");

  let data;

  try {
    data = await fetchList(source);
  } catch (error) {
    console.error("❌ cartoonslk list error:", error?.message || error);
    await react(sock, msg, "❌");

    return say(sock, msg, `❌ ${error?.message || "Could not load the list"}`);
  }

  if (!data.items.length) {
    await react(sock, msg, "❌");

    return say(sock, msg, source.kind === "search" ? `😕 No results found for "${source.q}".` : "😕 Nothing found.");
  }

  const sent = await say(sock, msg, buildList(source, data));

  remember(sent, {
    type: "list",
    chat: msg.key.remoteJid,
    source: { ...source, page: data.page },
    data,
    items: data.items
  });

  await react(sock, msg, "✅");
}

async function sendDownloadList(sock, msg, entryBase, title, downloads) {
  const list = buildDownloadList(title, downloads);
  const sent = await say(sock, msg, list.text);

  if (list.items.length) {
    remember(sent, {
      type: "downloads",
      chat: msg.key.remoteJid,
      items: list.items,
      title,
      pageUrl: entryBase.pageUrl,
      number: entryBase.number
    });
  }
}

async function sendDetails(sock, msg, item) {
  const from = msg.key.remoteJid;

  await react(sock, msg, "⏳");

  let details;

  try {
    details = await fetchDetails(item.url);
  } catch (error) {
    console.error("❌ cartoonslk details error:", error?.message || error);
    await react(sock, msg, "❌");

    return say(sock, msg, "❌ Could not load the details. Please try again in a moment.");
  }

  // 1) details card with poster
  const caption = buildDetailsCard(details);
  const poster = await getPoster(details.image || item.image);

  try {
    if (!poster) throw new Error("no poster");

    await sock.sendMessage(from, { image: poster, caption }, { quoted: msg });
  } catch {
    await say(sock, msg, caption);
  }

  // 2) episodes (series) or the download list (single movie)
  if (details.episodes.length) {
    const list = buildEpisodeList(details);
    const sent = await say(sock, msg, list.text);

    remember(sent, {
      type: "episodes",
      chat: from,
      items: list.items,
      title: details.title,
      pageUrl: details.url
    });
  } else {
    await sendDownloadList(sock, msg, { pageUrl: details.url, number: "" }, shortTitle(details.title), details.downloads);
  }

  await react(sock, msg, "✅");
}

async function sendEpisodeDownloads(sock, msg, episode, entry) {
  const title = `${shortTitle(entry.title)} - Episode ${episode.number}`;

  await sendDownloadList(
    sock,
    msg,
    { pageUrl: entry.pageUrl, number: episode.number },
    title,
    episode.downloads
  );
}

// .clktest — checks every endpoint and shows what the download API answers
async function runTest(sock, msg) {
  if (!isOwner(msg)) return say(sock, msg, "👑 Only the owner can run this test.");

  await say(sock, msg, "🧪 Testing the APIs... this can take a minute.");

  const redact = text => String(text).split(API_KEY).join("***");

  const check = async (name, fn) => {
    const t0 = Date.now();

    try {
      return `✅ ${name} — ${await fn()} (${((Date.now() - t0) / 1000).toFixed(1)}s)`;
    } catch (error) {
      return `❌ ${name} — ${redact(error?.message || error)} (${((Date.now() - t0) / 1000).toFixed(1)}s)`;
    }
  };

  let sample = null;

  const lines = [
    await check("Search", async () => {
      const data = normalizeList(await fetchApi("search", { q: "Ben 10" }));

      sample = data.items[0] || null;

      return `${data.items.length} results`;
    }),
    await check("Latest", async () => `${normalizeList(await fetchApi("latest")).items.length} results`),
    await check("Category", async () => `${normalizeList(await fetchApi("category", { slug: "cartoons" })).items.length} results`)
  ];

  let details = null;

  lines.push(
    await check("Details", async () => {
      details = await fetchDetails(sample?.url || "https://cartoons.lk/ben-10-ultimate-alien-season-2-sinhala-dubbed-cartoon/");

      return `${details.episodes.length} episodes, ${details.downloads.length} direct downloads`;
    })
  );

  const item = details?.episodes?.[0]?.downloads?.[0] || details?.downloads?.[0];

  lines.push(
    await check("Download", async () => {
      if (!item) throw new Error("no download item to test with");

      const entry = { pageUrl: details.url, number: details.episodes?.[0]?.number ?? "" };

      if (DL_TEMPLATE) {
        const link = await resolveDownloadLink(entry, item);

        return `template OK • ${link.slice(0, 60)}…`;
      }

      // try every guessed endpoint name at once
      const results = await Promise.all(
        DL_CANDIDATES.map(name =>
          callDownloadApi(name, entry, item, 20000).catch(error => ({
            endpoint: name,
            status: 0,
            notFound: false,
            link: "",
            text: String(error?.message || error)
          }))
        )
      );

      const hit = results.find(r => r.link);

      if (hit) {
        knownEndpoint = hit.endpoint;

        return `endpoint "${hit.endpoint}" works ✔ • ${hit.link.slice(0, 60)}…`;
      }

      const real = results.filter(r => !r.notFound);

      if (!real.length) {
        throw new Error(`all ${results.length} guessed endpoint names answered "not found" — send me the download API curl`);
      }

      throw new Error(
        "\n" + real.map(r => `   • ${r.endpoint} → HTTP ${r.status} ${redactKey(r.text).replace(/\s+/g, " ").slice(0, 170)}`).join("\n")
      );
    })
  );

  return say(sock, msg, `🧪 *CARTOONS.LK API TEST*\n\n${lines.join("\n")}`);
}

/* =====================================================
PLUGIN
===================================================== */

export default {
  command: "clk",
  commands: ALL_COMMANDS,

  // tells index.js to call handleReply() for replies to bot messages
  replyHandler: true,

  async execute(sock, msg, args = [], commandName = "") {
    const prefix = await getPrefix();
    const name = String(commandName || "").toLowerCase();

    if (TEST_COMMANDS.includes(name)) return runTest(sock, msg);

    if (LATEST_COMMANDS.includes(name)) {
      const page = Math.max(1, parseInt(args[0], 10) || 1);

      return sendList(sock, msg, { kind: "latest", page });
    }

    if (CATEGORY_COMMANDS.includes(name)) {
      const slug = String(args[0] || "cartoons").toLowerCase().replace(/[^a-z0-9-]/g, "");
      const page = Math.max(1, parseInt(args[1], 10) || 1);

      return sendList(sock, msg, { kind: "category", slug: slug || "cartoons", page });
    }

    const query = args.join(" ").trim();

    if (!query) {
      return say(
        sock,
        msg,
        `🎬 *CARTOONS.LK*\n\n` +
          `🔎 ${prefix}clk <name>\n   Example: ${prefix}clk Ben 10\n` +
          `🆕 ${prefix}clklatest\n` +
          `📂 ${prefix}clkcat cartoons\n` +
          `🔗 ${prefix}clk <cartoons.lk link>`
      );
    }

    // a cartoons.lk link was pasted → go straight to the details
    if (isCartoonsUrl(query)) {
      return sendDetails(sock, msg, { url: query.split(/\s+/)[0], title: "", image: "" });
    }

    return sendList(sock, msg, { kind: "search", q: query, page: 1 });
  },

  async handleReply(sock, msg, text) {
    const value = String(text || "").trim();
    const nav = value.match(/^(next|n|prev|previous|p)$/i);
    const pick = value.match(/^(\d{1,3})(?:\s*(doc|document|d|vid|video|v))?$/i);

    if (!nav && !pick) return false;

    const from = msg.key.remoteJid;
    const quotedId = stanzaIdOf(msg);
    const entry = store.get(quotedId);

    // not a reply to one of our lists → let other plugins handle it
    if (!entry || entry.chat !== from) return false;

    if (Date.now() - entry.time > CACHE_TTL) {
      store.delete(quotedId);
      await say(sock, msg, "⌛ This list has expired. Please search again.");

      return true;
    }

    if (!(await replyAllowed(sock, msg))) {
      await say(sock, msg, "💎 This is a Premium feature.\n\nContact the owner or a bot admin to get Premium.");

      return true;
    }

    try {
      /* ---- next / prev page ---- */
      if (nav) {
        if (entry.type !== "list") return false;

        const forward = /^n/i.test(nav[1]);

        if (forward && !entry.data.hasNext) {
          await say(sock, msg, "ℹ️ This is the last page.");

          return true;
        }

        if (!forward && !entry.data.hasPrevious) {
          await say(sock, msg, "ℹ️ This is the first page.");

          return true;
        }

        await sendList(sock, msg, { ...entry.source, page: entry.source.page + (forward ? 1 : -1) });

        return true;
      }

      /* ---- number picks ---- */
      const number = parseInt(pick[1], 10);
      const item = entry.items[number - 1];

      if (!item) {
        await say(sock, msg, `❌ Please send a number between 1 and ${entry.items.length}.`);

        return true;
      }

      if (entry.type === "list") {
        await sendDetails(sock, msg, item);
      } else if (entry.type === "episodes") {
        await sendEpisodeDownloads(sock, msg, item, entry);
      } else if (entry.type === "downloads") {
        const modeWord = (pick[2] || "").toLowerCase();
        const mode = !modeWord ? DEFAULT_SEND_MODE : modeWord.startsWith("v") ? "video" : "document";

        await downloadItem(sock, msg, entry, item, mode);
      }
    } catch (error) {
      console.error("❌ cartoonslk reply error:", error?.stack || error?.message || error);
      await say(sock, msg, `❌ Something went wrong: ${error?.message || "unknown error"}`);
    }

    return true;
  }
};

// exported for testing only
export const __test = { extractLink, fillTemplate, normalizeList, shortTitle, buildList, resolveDownloadLink };
