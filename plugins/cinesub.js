// plugins/cinesubz.js
// ─────────────────────────────────────────────────────────────
// CINESUBZ — all-in-one plugin (Search + Details + Download)
//
//   .cinesubz <name>        → search results list
//   (reply with a number)   → details card + download list
//   (reply with a number)   → file is downloaded and sent to the chat
//   .cinesubzinfo <link>    → details + download list for a cinesubz link
//   .cinesubzdl <link>      → download a direct file link (pixeldrain / supercloud ...)
//
// APIs used
//   1) Search    : https://supunofc.site/api/movie/cinesubz/search
//   2) Details   : https://supunofc.site/api/movie/cinesubz/details
//   3) Downloads : https://api.chamindu.site/api/v1/movies/cinesubz/infodl
//
// Requires Node 18+ (built-in fetch). Written for SHAN MINI BOT's index.js
// (commands[] + execute() + replyHandler/handleReply()).
// ─────────────────────────────────────────────────────────────

import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import { Readable, Transform } from "stream";
import { pipeline } from "stream/promises";

/* =========================
   CONFIG
========================= */

const SUPUN_BASE = "https://supunofc.site/api/movie/cinesubz";
const SUPUN_KEY = process.env.SUPUN_API_KEY || "supun_af8911b597c7165c2bbadbf42ed97bae";

const CHAMINDU_URL = "https://api.chamindu.site/api/v1/movies/cinesubz/infodl";
const CHAMINDU_KEY = process.env.CHAMINDU_API_KEY || "chama_api_42b49004bb95d5985ef6a0a89fc18fec";

const MAX_SHOW = 10; // search results shown
const MAX_MB = Number(process.env.CINESUBZ_MAX_MB) || 2000; // biggest file the bot will upload (WhatsApp caps documents at ~2 GB)
const CACHE_TTL = 30 * 60 * 1000; // reply lists stay valid for 30 minutes
const API_TIMEOUT = 25000;
const DL_API_TIMEOUT = 60000; // chamindu infodl can be slow

// How the movie is sent by default:  "document" (video file as document) or "video" (playable inline)
// Per download you can override it:  reply "3"  /  "3 doc"  /  "3 vid"
// Temp folder for downloads. /tmp is often tiny on panels (ENOSPC), so use a folder
// inside the bot directory instead. Change with CINESUBZ_TMP_DIR if you have a bigger disk.
const TMP_DIR = path.resolve(process.env.CINESUBZ_TMP_DIR || "./tmp");

const DEFAULT_SEND_MODE = process.env.CINESUBZ_SEND_MODE === "video" ? "video" : "document";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const MARKER_SEARCH = "CINESUBZ SEARCH";
const MARKER_EPISODES = "CINESUBZ EPISODES";
const MARKER_DL = "CINESUBZ DOWNLOADS";

const INFO_COMMANDS = ["cinesubzinfo", "csinfo"];
const DL_COMMANDS = ["cinesubzdl", "csdl"];
const TEST_COMMANDS = ["cinesubztest", "cstest"];

const REAL_GENRES = new Set([
  "action", "adventure", "animation", "comedy", "crime", "documentary", "drama",
  "family", "fantasy", "history", "horror", "music", "mystery", "romance",
  "science fiction", "sci-fi", "thriller", "war", "western", "sport", "short"
]);

/* =========================
   TEMP FOLDER
   Baileys also uses os.tmpdir() while uploading (encrypted copy), so we point
   TMPDIR / TEMP / TMP to our folder too — both use the big disk.
========================= */

try {
  fs.mkdirSync(TMP_DIR, { recursive: true });
  process.env.TMPDIR = TMP_DIR;
  process.env.TEMP = TMP_DIR;
  process.env.TMP = TMP_DIR;
} catch (error) {
  console.error("❌ cinesubz tmp dir error:", error?.message || error);
}

// delete leftovers from crashed / failed downloads (older than 10 minutes)
function cleanTempDir() {
  try {
    const now = Date.now();
    for (const file of fs.readdirSync(TMP_DIR)) {
      const full = path.join(TMP_DIR, file);
      try {
        const st = fs.statSync(full);
        if (st.isFile() && now - st.mtimeMs > 10 * 60 * 1000) fs.rmSync(full, { force: true });
      } catch {}
    }
  } catch {}
}

// free disk space (MB) of the temp folder, or null if it can't be read
function freeDiskMB(dir) {
  try {
    const st = fs.statfsSync(dir);
    return (st.bavail * st.bsize) / (1024 * 1024);
  } catch {
    return null;
  }
}

cleanTempDir();

/* =========================
   STATE (reply lists)
   key = id of the message the bot sent
========================= */

const store = {
  byMsg: new Map(), // messageId -> { type, chat, time, ... }
  busy: new Set() // chats that currently have a download running
};

function cleanCache() {
  const now = Date.now();
  for (const [id, entry] of store.byMsg) {
    if (now - entry.time > CACHE_TTL) store.byMsg.delete(id);
  }
  while (store.byMsg.size > 300) {
    store.byMsg.delete(store.byMsg.keys().next().value);
  }
}

function remember(sent, entry) {
  cleanCache();
  if (sent?.key?.id) store.byMsg.set(sent.key.id, { ...entry, time: Date.now() });
}

/* =========================
   SMALL HELPERS
========================= */

async function getPrefix() {
  try {
    if (mongoose.connection.readyState === 1) {
      const s = await mongoose.connection
        .collection("botsettings")
        .findOne({}, { projection: { prefix: 1 } });
      if (s?.prefix) return s.prefix;
    }
  } catch {}
  return process.env.PREFIX || ".";
}

const say = (sock, msg, text) =>
  sock.sendMessage(msg.key.remoteJid, { text }, { quoted: msg });

const react = async (sock, msg, emoji) => {
  try {
    await sock.sendMessage(msg.key.remoteJid, { react: { text: emoji, key: msg.key } });
  } catch {}
};

function cleanTitle(title = "") {
  return String(title)
    .replace(/\s*\|\s*සිංහල.*$/u, "")
    .replace(/\s*Sinhala Subtitles/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function typeLabel(type) {
  return type === "tv" ? "📺 TV Series" : "🎬 Movie";
}

function parseSizeMB(size = "") {
  const m = String(size).match(/([\d.]+)\s*(GB|MB|KB)/i);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  const unit = m[2].toUpperCase();
  return unit === "GB" ? n * 1024 : unit === "MB" ? n : n / 1024;
}

function safeName(name = "") {
  return String(name)
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function truncate(text = "", max = 350) {
  const t = String(text).replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function stanzaIdOf(msg) {
  const m = msg?.message?.ephemeralMessage?.message || msg?.message;
  return (
    m?.extendedTextMessage?.contextInfo?.stanzaId ||
    m?.imageMessage?.contextInfo?.stanzaId ||
    m?.videoMessage?.contextInfo?.stanzaId ||
    ""
  );
}

async function getJson(url, timeout = API_TIMEOUT) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: controller.signal
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/* =========================
   API 1 — SEARCH (supunofc)
========================= */

async function searchMovies(query) {
  const url = `${SUPUN_BASE}/search?q=${encodeURIComponent(query)}&apikey=${SUPUN_KEY}`;
  const json = await getJson(url);
  if (!json?.success || !Array.isArray(json.result)) {
    throw new Error("Search API returned an invalid response");
  }
  return json.result;
}

/* =========================
   API 2 — DETAILS (supunofc)
========================= */

function pickGenres(list = []) {
  return [...new Set((list || []).filter(g => REAL_GENRES.has(String(g).toLowerCase())))];
}

function normalizeEpisodes(list = []) {
  return (list || [])
    .map((e, i) => ({
      title: e?.title || e?.name || e?.episode || `Episode ${i + 1}`,
      link: e?.link || e?.href || e?.url || ""
    }))
    .filter(e => e.link);
}

async function fetchSupunDetails(link) {
  const url = `${SUPUN_BASE}/details?url=${encodeURIComponent(link)}&apikey=${SUPUN_KEY}`;
  const json = await getJson(url);
  const r = json?.result;
  if (!json?.success || !r) throw new Error("Details API returned an invalid response");

  return {
    title: cleanTitle(r.title),
    image: r.poster || "",
    rating: r.rating || "",
    director: r.director || "",
    genres: pickGenres(r.genres),
    cast: (r.cast || []).map(c => c?.name).filter(Boolean),
    story: r.synopsisSinhala || "",
    episodes: normalizeEpisodes(r.episodes),
    pageDownloads: (r.downloads || []).map(d => ({ href: d.href, meta: d.meta || "" }))
  };
}

/* =========================
   API 3 — DOWNLOADS (chamindu)
========================= */

function linkVariants(link) {
  const variants = [link];
  if (/cinesubz\.net/i.test(link)) variants.push(link.replace(/cinesubz\.net/i, "cinesubz.lk"));
  else if (/cinesubz\.lk/i.test(link)) variants.push(link.replace(/cinesubz\.lk/i, "cinesubz.net"));
  return variants;
}

async function fetchChamindu(link) {
  let lastError = null;

  for (const variant of linkVariants(link)) {
    try {
      const url = `${CHAMINDU_URL}?q=${encodeURIComponent(variant)}&api_key=${CHAMINDU_KEY}`;
      const json = await getJson(url, DL_API_TIMEOUT);
      const d = json?.data;
      if (!json?.status || !d) throw new Error("Download API returned an invalid response");

      return {
        title: cleanTitle(d.title),
        image: d.image || "",
        rating: d.rating || "",
        director: d.director || d.directors || "",
        genres: pickGenres(d.genres),
        cast: (d.cast || []).map(c => c?.name).filter(Boolean),
        story: d.story || "",
        year: d.year || "",
        duration: d.duration || "",
        downloads: organizeDownloads((d.downloads || []).map(toItem))
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("Download API failed");
}

function detectKind(link = "") {
  if (/telegram\.(me|org)|t\.me\//i.test(link)) return "telegram";
  if (/pixeldrain\.com/i.test(link)) return "pixeldrain";
  return "direct";
}

function toItem(d) {
  const raw = String(d.quality || "");
  const m = raw.match(/^(.*?)\s*\[(.*?)\]\s*$/);

  return {
    label: raw,
    quality: (m ? m[1] : raw).trim(),
    source: (m ? m[2] : "").trim(),
    size: d.size || "",
    language: d.language || "",
    link: d.link || "",
    kind: detectKind(d.link)
  };
}

// Remove Telegram links, sort smallest file first, keep max 2 mirrors per quality
// (Direct server first, then PixelDrain)
function organizeDownloads(items) {
  const usable = items.filter(x => x.link && x.kind !== "telegram");
  const rank = x => (x.kind === "direct" ? 0 : 1);

  usable.sort(
    (a, b) =>
      parseSizeMB(a.size) - parseSizeMB(b.size) ||
      String(a.quality).localeCompare(String(b.quality)) ||
      rank(a) - rank(b)
  );

  const perQuality = new Map();
  return usable.filter(x => {
    const n = perQuality.get(x.quality) || 0;
    perQuality.set(x.quality, n + 1);
    return n < 2;
  });
}

function pageItemFromMeta(d) {
  // meta example: "BluRay 480p • 1.6 GB • English"
  const [quality = "", size = "", language = ""] = String(d.meta || "")
    .split("•")
    .map(x => x.trim());

  return {
    label: d.meta || quality,
    quality,
    source: "Web page",
    size,
    language,
    link: d.href,
    kind: "page"
  };
}

/* =========================
   DETAILS (merge APIs 2 + 3)
========================= */

async function fetchDetails(link) {
  const [a, b] = await Promise.allSettled([fetchSupunDetails(link), fetchChamindu(link)]);
  const sup = a.status === "fulfilled" ? a.value : null;
  const cha = b.status === "fulfilled" ? b.value : null;

  if (a.status === "rejected") console.error("❌ cinesubz details API failed:", a.reason?.message || a.reason);
  if (b.status === "rejected") console.error("❌ cinesubz download API failed:", b.reason?.message || b.reason);

  if (!sup && !cha) {
    throw new Error(a.reason?.message || b.reason?.message || "Both APIs failed");
  }

  let downloads = cha?.downloads || [];
  if (!downloads.length && sup?.pageDownloads?.length) {
    downloads = sup.pageDownloads.map(pageItemFromMeta);
  }

  return {
    link,
    title: sup?.title || cha?.title || "",
    image: sup?.image || cha?.image || "",
    rating: sup?.rating || cha?.rating || "",
    director: sup?.director || cha?.director || "",
    genres: cha?.genres?.length ? cha.genres : sup?.genres || [],
    cast: sup?.cast?.length ? sup.cast : cha?.cast || [],
    story: cha?.story || sup?.story || "",
    year: cha?.year || "",
    duration: cha?.duration || "",
    episodes: sup?.episodes || [],
    downloads,
    pageOnly: !cha?.downloads?.length && downloads.length > 0
  };
}

/* =========================
   MESSAGE BUILDERS
========================= */

function buildSearchList(query, shown) {
  let text = `🎬 *${MARKER_SEARCH}*\n🔎 Query: *${query}*\n\n`;

  shown.forEach((m, i) => {
    const extra = [
      typeLabel(m.type),
      m.quality ? `💿 ${m.quality}` : null,
      m.season ? `🗂️ ${m.season}` : null,
      m.rating ? `⭐ ${m.rating}` : null
    ]
      .filter(Boolean)
      .join(" • ");

    text += `*${i + 1}.* ${cleanTitle(m.title)}\n     ${extra}\n\n`;
  });

  text += `📩 *Reply* with a number to get details (1 - ${shown.length})`;
  return text;
}

function buildDetailsCard(d, item = {}) {
  const lines = [`🎬 *${d.title || cleanTitle(item.title) || "Unknown title"}*`, ""];

  if (d.rating) lines.push(`⭐ Rating : ${d.rating}`);
  if (d.year) lines.push(`📅 Year : ${d.year}`);
  if (d.duration) lines.push(`⏱️ Duration : ${d.duration}`);
  if (d.genres?.length) lines.push(`🎭 Genres : ${d.genres.join(", ")}`);
  if (d.director) lines.push(`🎥 Director : ${d.director.split(",").slice(0, 2).join(",").trim()}`);
  if (d.cast?.length) lines.push(`👥 Cast : ${d.cast.slice(0, 5).join(", ")}`);
  if (d.story) lines.push("", `📝 ${truncate(d.story, 350)}`);

  return lines.join("\n");
}

function buildEpisodeList(d) {
  const eps = d.episodes.slice(0, 99);
  let text = `📺 *${MARKER_EPISODES}*\n🎞️ ${d.title}\n\n`;
  eps.forEach((e, i) => {
    text += `*${i + 1}.* ${e.title}\n`;
  });
  text += `\n📩 *Reply* with a number to get the download links (1 - ${eps.length})`;
  return { text, items: eps };
}

function buildDownloadList(d) {
  const items = d.downloads.slice(0, 99);

  if (!items.length) {
    return {
      text:
        `📥 *${MARKER_DL}*\n🎞️ ${d.title}\n\n` +
        `😕 No download links were found for this title.`,
      items: []
    };
  }

  let text = `📥 *${MARKER_DL}*\n🎞️ ${d.title}\n\n`;

  items.forEach((it, i) => {
    const head = [it.quality, it.size].filter(Boolean).join(" • ");
    const tooBig = parseSizeMB(it.size) > MAX_MB;
    const tag =
      it.kind === "page"
        ? "🌐 Web page (link only)"
        : tooBig
        ? "🔗 Too big for WhatsApp (link only)"
        : it.kind === "pixeldrain"
        ? `⚡ ${it.source || "PixelDrain"}`
        : `🚀 ${it.source || "Direct"}`;

    text += `*${i + 1}.* ${head}\n     ${tag}\n`;
  });

  if (d.pageOnly) {
    text += `\n⚠️ Direct links could not be loaded for this title right now, so only web page links are shown.`;
  }
  text += `\n📩 *Reply* with a number to download (1 - ${items.length})`;
  text += `\n📄 Default: video file as *document*`;
  text += `\n🎞️ For a playable video reply like: *3 vid*  (document: *3 doc*)`;
  text += `\n⚠️ WhatsApp can only take files up to ~${Math.round(MAX_MB / 1024 * 10) / 10} GB, bigger ones are sent as a direct link.`;

  return { text, items };
}

/* =========================
   DOWNLOAD ENGINE
========================= */

// Small poster thumbnail so the video document shows a preview picture
async function getThumbnail(image) {
  try {
    if (!/image\.tmdb\.org/i.test(image || "")) return null;
    const small = image.replace(/\/(w\d+|original)\//, "/w185/");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const res = await fetch(small, { headers: { "User-Agent": UA }, signal: controller.signal });
      if (!res.ok) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      return buf.length < 150 * 1024 ? buf : null;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}

// Direct-server links contain expiring tokens, so grab a fresh one before downloading
async function freshLink(item, sourceUrl) {
  if (item.kind !== "direct" || !sourceUrl) return item.link;

  try {
    const d = await fetchChamindu(sourceUrl);
    const hit = d.downloads.find(x => x.label === item.label);
    return hit?.link || item.link;
  } catch {
    return item.link;
  }
}

async function downloadToTemp(url, file, maxMB) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "*/*" },
    redirect: "follow"
  });

  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

  const type = res.headers.get("content-type") || "";
  if (/text\/html/i.test(type)) {
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

async function downloadItem(sock, msg, item, title = "", sourceUrl = "", opts = {}) {
  const from = msg.key.remoteJid;

  if (item.kind === "telegram") {
    return say(
      sock,
      msg,
      `📲 Telegram bot link (open it in Telegram):\n\n🔗 ${item.link}`
    );
  }

  if (item.kind === "page") {
    return say(sock, msg, `🌐 Open this page in your browser to get the download links:\n\n🔗 ${item.link}`);
  }

  if (store.busy.has(from)) {
    return say(sock, msg, "⏳ A download is already running in this chat. Please wait until it finishes.");
  }

  store.busy.add(from);

  try {
    await react(sock, msg, "⏳");

    const url = await freshLink(item, sourceUrl);

    if (parseSizeMB(item.size) > MAX_MB) {
      return say(
        sock,
        msg,
        `⚠️ This file is too big (${item.size}) to send on WhatsApp. Direct link:\n\n🔗 ${url}`
      );
    }

    // file name: use the name inside the link, otherwise title + quality
    let urlName = "";
    try {
      urlName = decodeURIComponent(url.split("?")[0].split("/").pop() || "");
    } catch {}

    const ext = (urlName.match(/\.(mp4|mkv|avi|webm)$/i)?.[1] || "mp4").toLowerCase();
    const mimetype =
      ext === "mkv" ? "video/x-matroska" : ext === "webm" ? "video/webm" : "video/mp4";

    const quality = (item.quality || "").trim();
    const fileName = /\.(mp4|mkv|avi|webm)$/i.test(urlName)
      ? safeName(urlName)
      : `${safeName(`${title || "Movie"} ${quality}`)}.${ext}`;

    await say(
      sock,
      msg,
      `📤 *${title || fileName}* ${quality}\n⏳ Downloading... this can take a few minutes.`
    );

    cleanTempDir();

    // Upload needs the file + Baileys' encrypted copy, so ~2x the size must be free
    const needMB = parseSizeMB(item.size) * 2.1;
    const freeMB = freeDiskMB(TMP_DIR);

    if (freeMB !== null && needMB && freeMB < needMB) {
      await react(sock, msg, "❌");
      return say(
        sock,
        msg,
        `❌ Not enough free disk space on the bot server.\n\n` +
          `💾 Free : ${Math.round(freeMB)} MB\n` +
          `📦 Needed : about ${Math.round(needMB)} MB\n\n` +
          `Direct link:\n🔗 ${url}`
      );
    }

    const tmpFile = path.join(TMP_DIR, `cinesubz_${Date.now()}.${ext}`);

    try {
      await downloadToTemp(url, tmpFile, MAX_MB);

      const caption = `🎬 ${title || fileName}${item.quality ? `\n💿 ${item.quality}` : ""}${item.size ? ` • ${item.size}` : ""}`;

      // inline video only works for mp4 — mkv / avi / webm always go as a document
      const asVideo = (opts.mode || DEFAULT_SEND_MODE) === "video" && ext === "mp4";

      if (asVideo) {
        await sock.sendMessage(
          from,
          { video: { url: tmpFile }, mimetype: "video/mp4", fileName, caption },
          { quoted: msg }
        );
      } else {
        const jpegThumbnail = await getThumbnail(opts.image);
        await sock.sendMessage(
          from,
          {
            document: { url: tmpFile },
            mimetype,
            fileName,
            caption,
            ...(jpegThumbnail ? { jpegThumbnail } : {})
          },
          { quoted: msg }
        );
      }

      await react(sock, msg, "✅");
    } catch (error) {
      console.error("❌ cinesubz download error:", error?.message || error);

      const diskFull = error?.code === "ENOSPC" || /ENOSPC/i.test(error?.message || "");
      const reason = error?.tooBig
        ? "The file is too big."
        : diskFull
        ? "The bot server's disk is full. Free some space (or set CINESUBZ_TMP_DIR to a bigger disk)."
        : `Download / upload failed (${error?.message || "unknown error"}).`;

      await say(sock, msg, `❌ ${reason}\n\nDirect link:\n🔗 ${url}`);
      await react(sock, msg, "❌");
    } finally {
      try {
        fs.rmSync(tmpFile, { force: true });
      } catch {}
    }
  } finally {
    store.busy.delete(from);
  }
}

/* =========================
   FLOWS
========================= */

async function sendDownloadList(sock, msg, details, sourceUrl) {
  const list = buildDownloadList(details);
  const sent = await sock.sendMessage(
    msg.key.remoteJid,
    { text: list.text },
    { quoted: msg }
  );

  if (list.items.length) {
    remember(sent, {
      type: "downloads",
      chat: msg.key.remoteJid,
      items: list.items,
      title: details.title,
      sourceUrl,
      image: details.image
    });
  }
}

async function sendDetails(sock, msg, item) {
  const from = msg.key.remoteJid;
  await react(sock, msg, "⏳");

  let details;
  try {
    details = await fetchDetails(item.link);
  } catch (error) {
    console.error("❌ cinesubz details error:", error?.message || error);
    await react(sock, msg, "❌");
    return say(sock, msg, "❌ Could not load the details. Please try again in a moment.");
  }

  // 1) details card
  const caption = buildDetailsCard(details, item);
  const poster = details.image || item.image;

  try {
    if (!poster) throw new Error("no image");
    await sock.sendMessage(from, { image: { url: poster }, caption }, { quoted: msg });
  } catch {
    await say(sock, msg, caption);
  }

  // 2) episodes (TV series) or download list
  if (details.episodes.length) {
    const list = buildEpisodeList(details);
    const sent = await sock.sendMessage(from, { text: list.text }, { quoted: msg });
    remember(sent, { type: "episodes", chat: from, items: list.items, title: details.title });
  } else {
    await sendDownloadList(sock, msg, details, item.link);
  }

  await react(sock, msg, "✅");
}

async function sendEpisodeDownloads(sock, msg, episode, seriesTitle) {
  await react(sock, msg, "⏳");

  let details;
  try {
    details = await fetchDetails(episode.link);
  } catch (error) {
    console.error("❌ cinesubz episode error:", error?.message || error);
    await react(sock, msg, "❌");
    return say(sock, msg, "❌ Could not load this episode. Please try again in a moment.");
  }

  details.title = `${seriesTitle ? `${seriesTitle} - ` : ""}${episode.title}`;
  await sendDownloadList(sock, msg, details, episode.link);
  await react(sock, msg, "✅");
}

// .cinesubztest [cinesubz link]  → checks all 3 APIs and reports what works
async function runTest(sock, msg, link) {
  const target =
    link || "https://cinesubz.net/movies/avatar-the-way-of-water-2022-sinhala-subtitles/";

  const check = async (name, fn) => {
    const t0 = Date.now();
    try {
      const info = await fn();
      return `✅ ${name} — ${info} (${((Date.now() - t0) / 1000).toFixed(1)}s)`;
    } catch (error) {
      return `❌ ${name} — ${error?.message || error} (${((Date.now() - t0) / 1000).toFixed(1)}s)`;
    }
  };

  await say(sock, msg, "🧪 Testing the APIs... this can take up to a minute.");

  const lines = [
    await check("Search", async () => `${(await searchMovies("Avatar")).length} results`),
    await check("Details", async () => {
      const d = await fetchSupunDetails(target);
      return `${d.title || "no title"}, ${d.pageDownloads.length} page links, ${d.episodes.length} episodes`;
    }),
    await check("Downloads", async () => {
      const d = await fetchChamindu(target);
      return `${d.downloads.length} links (${d.downloads.map(x => x.quality).slice(0, 3).join(" | ")})`;
    })
  ];

  return say(sock, msg, `🧪 *CINESUBZ API TEST*\n🔗 ${target}\n\n${lines.join("\n")}`);
}

async function runSearch(sock, msg, query, prefix) {
  if (!query) {
    return say(
      sock,
      msg,
      `🎬 *CINESUBZ SEARCH*\n\nUsage: ${prefix}cinesubz <movie / tv name>\nExample: ${prefix}cinesubz Avatar`
    );
  }

  // a cinesubz link was pasted → go straight to details
  if (/^https?:\/\/(www\.)?cinesubz\.[a-z]+\//i.test(query)) {
    const type = query.includes("/tvshows/") ? "tv" : "movie";
    return sendDetails(sock, msg, { link: query, title: "", type });
  }

  await react(sock, msg, "🔎");

  let results;
  try {
    results = await searchMovies(query);
  } catch (error) {
    console.error("❌ cinesubz search error:", error?.message || error);
    await react(sock, msg, "❌");
    return say(sock, msg, "❌ Search failed. Please try again in a moment.");
  }

  if (!results.length) {
    return say(sock, msg, `😕 No results found for "${query}".`);
  }

  const shown = results.slice(0, MAX_SHOW);
  const sent = await sock.sendMessage(
    msg.key.remoteJid,
    { text: buildSearchList(query, shown) },
    { quoted: msg }
  );

  remember(sent, { type: "search", chat: msg.key.remoteJid, items: shown, query });
}

/* =========================
   PLUGIN
========================= */

export default {
  commands: [
    "cinesubz", "cs", "csubz", "cinesub",
    ...INFO_COMMANDS,
    ...DL_COMMANDS,
    ...TEST_COMMANDS
  ],

  // tells index.js to call handleReply() for replies to bot messages
  replyHandler: true,

  async execute(sock, msg, args, commandName) {
    const prefix = await getPrefix();
    const name = String(commandName || "").toLowerCase();
    const first = args[0] || "";

    /* .cinesubztest [link] */
    if (TEST_COMMANDS.includes(name)) {
      return runTest(sock, msg, /^https?:\/\//i.test(first) ? first : "");
    }

    /* .cinesubzinfo <link> */
    if (INFO_COMMANDS.includes(name)) {
      if (!/^https?:\/\/(www\.)?cinesubz\.[a-z]+\//i.test(first)) {
        return say(sock, msg, `Usage: ${prefix}cinesubzinfo <cinesubz movie / tvshow link>`);
      }
      const type = first.includes("/tvshows/") ? "tv" : "movie";
      return sendDetails(sock, msg, { link: first, title: "", type });
    }

    /* .cinesubzdl <direct link> */
    if (DL_COMMANDS.includes(name)) {
      if (!/^https?:\/\//i.test(first)) {
        return say(
          sock,
          msg,
          `Usage: ${prefix}cinesubzdl <direct file link (pixeldrain / supercloud ...)>`
        );
      }
      return downloadItem(sock, msg, {
        label: "",
        quality: "",
        size: "",
        link: first,
        kind: detectKind(first)
      });
    }

    /* .cinesubz <name> */
    return runSearch(sock, msg, args.join(" ").trim(), prefix);
  },

  async handleReply(sock, msg, text) {
    const parsed = String(text || "").trim().match(/^(\d{1,2})(?:\s*(doc|document|d|vid|video|v))?$/i);
    if (!parsed) return false;

    const value = parsed[1];
    const modeWord = (parsed[2] || "").toLowerCase();
    const mode = !modeWord ? DEFAULT_SEND_MODE : modeWord.startsWith("v") ? "video" : "document";

    const from = msg.key.remoteJid;
    const entry = store.byMsg.get(stanzaIdOf(msg));

    // not a reply to one of our lists → let other plugins handle it
    if (!entry || entry.chat !== from) return false;

    if (Date.now() - entry.time > CACHE_TTL) {
      store.byMsg.delete(stanzaIdOf(msg));
      await say(sock, msg, "⌛ This list has expired. Please search again.");
      return true;
    }

    const item = entry.items[parseInt(value, 10) - 1];
    if (!item) {
      await say(sock, msg, `❌ Please send a number between 1 and ${entry.items.length}.`);
      return true;
    }

    try {
      if (entry.type === "search") {
        await sendDetails(sock, msg, item);
      } else if (entry.type === "episodes") {
        await sendEpisodeDownloads(sock, msg, item, entry.title);
      } else if (entry.type === "downloads") {
        await downloadItem(sock, msg, item, entry.title, entry.sourceUrl, { mode, image: entry.image });
      }
    } catch (error) {
      console.error("❌ cinesubz reply error:", error?.stack || error?.message || error);
      await say(sock, msg, `❌ Something went wrong: ${error?.message || "unknown error"}`);
    }

    return true;
  }
};
