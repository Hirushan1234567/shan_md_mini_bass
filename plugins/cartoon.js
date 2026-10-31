// plugins/cartoon.js
// ─────────────────────────────────────────────────────────────
// CARTOON — all-in-one plugin (Search + Episodes + Download)
// Same flow / style as the cinesubz plugin.
//
//   .cartoon <name>         → search results list
//   (reply with a number)   → details card + episode list
//   (reply with a number)   → episode card + download (quality) list
//   (reply with a number)   → file is downloaded and sent to the chat
//   .cartoonlist            → every cartoon on the site (numbered, in parts)
//   .cartoonlist <a-z>      → only the ones starting with that letter
//   .cartoon debug <link>   → inspect a page (for fixing the parser)
//
// Source: sinhalacartoons.com (change with CARTOON_SITE)
//
// Optional: npm i @napi-rs/canvas  → styled 1280x720 thumbnail card
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

const MAX_SHOW = 30; // search results shown
const MAX_LIST = 1000; // ".cartoonlist" results kept
const LIST_PAGE = 100; // titles per list message
const MAX_MB = Number(process.env.CARTOON_MAX_MB) || 2000; // WhatsApp caps documents at ~2 GB
const CACHE_TTL = 30 * 60 * 1000; // reply lists stay valid for 30 minutes
const TMP_DIR = path.resolve(process.env.CARTOON_TMP_DIR || "./tmp");

// "document" (file as document) or "video" (playable inline).
// Per download you can override it:  reply "2"  /  "2 doc"  /  "2 vid"
const DEFAULT_SEND_MODE = process.env.CARTOON_SEND_MODE === "video" ? "video" : "document";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const MARKER_SEARCH = "CARTOON SEARCH";
const MARKER_EPISODES = "CARTOON EPISODES";
const MARKER_DL = "CARTOON DOWNLOADS";

/* =========================
   TEMP FOLDER
   Baileys also uses os.tmpdir() while uploading, so TMPDIR is pointed
   to the same folder (same idea as the cinesubz plugin).
========================= */

try {
  fs.mkdirSync(TMP_DIR, { recursive: true });
  process.env.TMPDIR = TMP_DIR;
  process.env.TEMP = TMP_DIR;
  process.env.TMP = TMP_DIR;
} catch (error) {
  console.error("❌ cartoon tmp dir error:", error?.message || error);
}

// delete leftovers of crashed downloads (older than 10 minutes)
function cleanTempDir() {
  try {
    const now = Date.now();
    for (const file of fs.readdirSync(TMP_DIR)) {
      if (!file.startsWith("cartoon_")) continue;
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

const clip = (text, max = 150) => {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

const truncate = (text, max = 350) => clip(text, max);

const safeName = (name = "") =>
  String(name)
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);

// "Ben 10 ... Sinhala Dubbed- සිංහල හඩකැවූ" → "Ben 10 ..."
function cleanTitle(title = "") {
  return String(title)
    .replace(/\s*[-–|]?\s*(Sinhala Dubbed)?\s*[-–|]?\s*සිංහල.*$/u, "")
    .replace(/\s*[-–|]\s*Sinhala Cartoons\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function formatSize(bytes) {
  if (!bytes) return "";
  return bytes >= 1073741824
    ? `${(bytes / 1073741824).toFixed(2)} GB`
    : `${Math.round(bytes / 1048576)} MB`;
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

async function fetchBuffer(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(30000)
  });
  if (!res.ok) throw new Error(`Image error (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

/* =====================================================
PROVIDER LAYER - cartoons.lk (WordPress site)
Search/browse use the site's WordPress REST API.
Episodes/downloads are read from the post page HTML.
Use ".cartoon debug <post-url>" to inspect a page.
===================================================== */

const SITE = (process.env.CARTOON_SITE || "https://sinhalacartoons.com").replace(/\/+$/, "");

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeHtml(text) {
  return String(text || "")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

const stripHtml = html =>
  decodeHtml(
    String(html || "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();

async function http(url, asJson = false) {
  const res = await fetch(url, {
    headers: { "user-agent": UA, accept: asJson ? "application/json" : "text/html,*/*" },
    signal: AbortSignal.timeout(30000)
  });

  if (!res.ok) throw new Error(`Site error (${res.status})`);
  return asJson ? res.json() : res.text();
}

function extractLinks(html, baseUrl) {
  const links = [];
  const re = /<a\b[^>]*?href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;

  while ((m = re.exec(html))) {
    try {
      links.push({
        href: new URL(decodeHtml(m[1]), baseUrl).href,
        text: stripHtml(m[2])
      });
    } catch {}
  }

  return links;
}

const isNavLink = href =>
  href.startsWith(SITE) &&
  /(\/category\/|\/tag\/|\/author\/|#comment|#respond|\/about-us|\/contact-us|\/privacy|\/terms|\?replytocom)/i.test(href);

const metaContent = (html, prop) =>
  html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']+)`, "i"))?.[1] ||
  html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${prop}["']`, "i"))?.[1] ||
  "";

function pageInfo(html) {
  const title = stripHtml(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]);
  const image = decodeHtml(metaContent(html, "og:image"));

  let description = stripHtml(metaContent(html, "og:description") || metaContent(html, "description"));

  if (description.length < 40 || description === title) {
    description = "";
    const re = /<p[^>]*>([\s\S]*?)<\/p>/gi;
    let m;

    while ((m = re.exec(html))) {
      const t = stripHtml(m[1]);
      if (t.length > 60 && !/telegram|advert|comment|redirect/i.test(t)) {
        description = t;
        break;
      }
    }
  }

  return { title, image, description };
}

const mapPost = post => ({
  id: post.link,
  title: stripHtml(post.title?.rendered) || "Unknown",
  image: post._embedded?.["wp:featuredmedia"]?.[0]?.source_url || ""
});

let categoryIds = null;

async function getCategoryIds() {
  if (categoryIds !== null) return categoryIds;

  if (!process.env.CARTOON_CATEGORIES) {
    categoryIds = "";
    return categoryIds;
  }

  try {
    const cats = await http(`${SITE}/wp-json/wp/v2/categories?slug=${process.env.CARTOON_CATEGORIES}&per_page=10`, true);
    categoryIds = cats.map(c => c.id).join(",");
  } catch {
    categoryIds = "";
  }

  return categoryIds;
}

async function searchHtml(query) {
  const html = await http(`${SITE}/?s=${encodeURIComponent(query)}&post_type=post`);
  const seen = new Set();
  const out = [];

  for (const link of extractLinks(html, SITE)) {
    if (!link.href.startsWith(`${SITE}/`) || isNavLink(link.href) || seen.has(link.href)) continue;

    const slug = link.href.slice(SITE.length + 1);

    if (!slug || /^[?#]/.test(slug) || slug.includes("#")) continue;
    if (/^(about-us|contact-us|privacy-policy|dmca-policy)\/?$/.test(slug)) continue;
    if (link.text.length < 4) continue;

    seen.add(link.href);
    out.push({ id: link.href, title: clip(link.text, 120), image: "" });
  }

  return out;
}

async function searchOnce(query) {
  try {
    const cats = await getCategoryIds();
    const url =
      `${SITE}/wp-json/wp/v2/posts?search=${encodeURIComponent(query)}` +
      `&per_page=30&_embed=wp:featuredmedia${cats ? `&categories=${cats}` : ""}`;

    const posts = await http(url, true);
    if (Array.isArray(posts) && posts.length) return posts.map(mapPost);
  } catch {}

  return searchHtml(query);
}

// "ben10" -> also try "ben 10"
async function searchCartoons(query) {
  const spaced = query.replace(/([a-z])(\d)/gi, "$1 $2").replace(/(\d)([a-z])/gi, "$1 $2");

  const sinhalaFirst = list =>
    list.sort((a, b) => Number(/sinhala|සිංහල/i.test(b.title)) - Number(/sinhala|සිංහල/i.test(a.title)));

  for (const q of [...new Set([query, spaced])]) {
    const items = await searchOnce(q);
    if (items.length) return sinhalaFirst(items);
  }

  return [];
}

let allCache = { at: 0, items: [] };

async function browseCartoons(letter) {
  if (Date.now() - allCache.at > 60 * 60 * 1000) {
    const cats = await getCategoryIds();
    const items = [];

    for (let page = 1; page <= 10; page++) {
      let batch;

      try {
        batch = await http(
          `${SITE}/wp-json/wp/v2/posts?per_page=100&page=${page}&orderby=title&order=asc` +
            `&_embed=wp:featuredmedia${cats ? `&categories=${cats}` : ""}`,
          true
        );
      } catch {
        break;
      }

      if (!batch.length) break;
      items.push(...batch.map(mapPost));
      if (batch.length < 100) break;
    }

    allCache = { at: Date.now(), items };
  }

  if (!letter) return allCache.items;

  return allCache.items.filter(x =>
    x.title.replace(/^[^a-z0-9]+/i, "").toLowerCase().startsWith(letter)
  );
}

/* ---- download links ----
The site hides each file as a base64url JSON blob {direct,title,...}
(in a ?sc_data= link, a data attribute or a script). We scan the whole
page for those blobs and for plain .mp4/.mkv URLs. */

function decodeBlob(raw) {
  try {
    if (!raw || raw.length < 40) return null;

    const text = Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    if (!text.startsWith("{")) return null;

    const json = JSON.parse(text);
    if (!json?.direct) return null;

    return { raw, direct: String(json.direct), title: stripHtml(json.title || "") };
  } catch {
    return null;
  }
}

const QUALITY_RE = /(2160|1440|1080|720|480|360|240)p/i;

const fileLabel = url => {
  try {
    return decodeURIComponent(String(url).split("?")[0].split("/").pop() || "");
  } catch {
    return String(url).split("/").pop() || "";
  }
};

const qualityOf = url => fileLabel(url).match(QUALITY_RE)?.[0]?.toLowerCase() || "Default";

const episodeNumber = file => {
  const m = String(file).match(/S\d+[ ._-]?E(\d{1,3})|\bE(\d{2,3})\b|Episode[ ._-]*(\d{1,3})/i);
  return m ? parseInt(m[1] || m[2] || m[3], 10) : null;
};

function collectDownloads(html) {
  const seen = new Set();
  const items = [];

  const add = d => {
    if (d && !seen.has(d.direct)) {
      seen.add(d.direct);
      items.push(d);
    }
  };

  for (const m of html.matchAll(/[A-Za-z0-9_-]{60,}/g)) add(decodeBlob(m[0]));

  for (const m of html.matchAll(/https?:(?:\\?\/){2}(?:[^"'\s<>\\]|\\\/)+?\.(?:mp4|mkv|m4v)(?=["'\s<>\\?&]|$)/gi)) {
    const direct = m[0].replace(/\\\//g, "/");
    add({ raw: Buffer.from(JSON.stringify({ direct })).toString("base64url"), direct, title: "" });
  }

  return items;
}

async function getCartoon(id) {
  const html = await http(id);
  const info = pageInfo(html);
  const items = collectDownloads(html);

  if (!items.length) {
    throw new Error(`No download links found on this page. Use the "cartoon debug" command with this link: ${id}`);
  }

  // Files that differ only by quality belong to one episode
  const groups = new Map();

  for (const item of items) {
    const key = fileLabel(item.direct).replace(QUALITY_RE, "").toLowerCase();
    if (!groups.has(key)) groups.set(key, []);

    const group = groups.get(key);
    if (group.some(x => qualityOf(x.direct) === qualityOf(item.direct))) continue;

    group.push(item);
  }

  const keys = [...groups.keys()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const episodes = keys.map((key, i) => {
    const group = groups.get(key);
    const file = fileLabel(group[0].direct);

    return {
      id: group.map(x => x.raw).join("|"),
      title: group[0].title || file,
      file,
      num: episodeNumber(file),
      number: i + 1
    };
  });

  if (episodes.length > 1) {
    const nums = episodes.map(e => e.num);
    const allNumbered = nums.every(n => n !== null) && new Set(nums).size === nums.length;

    if (allNumbered) {
      for (const ep of episodes) ep.title = `Episode ${String(ep.num).padStart(2, "0")}`;
      episodes.sort((a, b) => a.num - b.num);
    } else if (new Set(episodes.map(e => e.title)).size < episodes.length) {
      for (const ep of episodes) ep.title = ep.file;
    }
  }

  return { ...info, episodes };
}

async function getEpisode(id) {
  const downloads = id
    .split("|")
    .map(raw => {
      const d = decodeBlob(raw);
      return d && { quality: qualityOf(d.direct), url: d.direct, size: "", title: d.title };
    })
    .filter(Boolean)
    .sort((a, b) => (parseInt(a.quality, 10) || 0) - (parseInt(b.quality, 10) || 0));

  return { title: downloads[0]?.title || "", image: "", description: "", downloads };
}

async function debugPage(url) {
  const html = await http(url);
  const items = collectDownloads(html);
  const links = extractLinks(html, url).filter(l => !isNavLink(l.href)).slice(0, 25);
  const idx = html.search(/>\s*Episode\s*0?1\s*</i);
  const idx2 = idx >= 0 ? idx : html.search(/Select Episode/i);

  return {
    links:
      `Download items found: ${items.length}\n` +
      items.slice(0, 5).map(x => `• ${fileLabel(x.direct)}`).join("\n") +
      `\n\n` +
      links.map(l => `• ${clip(l.text, 40) || "(no text)"} → ${clip(l.href, 90)}`).join("\n"),
    snippet:
      idx2 >= 0
        ? html.slice(Math.max(0, idx2 - 400), idx2 + 800)
        : "(Episode list not found in HTML)"
  };
}

/* =====================================================
THUMBNAIL CARD (optional, needs @napi-rs/canvas)
===================================================== */

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrapLines(ctx, text, maxWidth, maxLines) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = "";

  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);

  if (lines.length > maxLines) {
    lines.length = maxLines;
    lines[maxLines - 1] = `${lines[maxLines - 1].replace(/.{1}$/, "")}…`;
  }
  return lines;
}

async function buildCard({ image, show, episode }) {
  let lib;
  try {
    lib = await import("@napi-rs/canvas");
  } catch {
    return null;
  }

  try {
    const { createCanvas, loadImage } = lib;
    const img = await loadImage(await fetchBuffer(image));

    const W = 1280;
    const H = 720;
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext("2d");

    // blurred background (downscale + upscale)
    const tiny = createCanvas(32, 18);
    tiny.getContext("2d").drawImage(img, 0, 0, 32, 18);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(tiny, 0, 0, W, H);
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, 0, W, H);

    // rounded poster (cover fit)
    const portrait = img.height > img.width * 1.2;
    const pw = portrait ? 300 : 560;
    const ph = portrait ? 450 : 340;
    const px = 60;
    const py = (H - ph) / 2;
    ctx.save();
    roundRectPath(ctx, px, py, pw, ph, 28);
    ctx.clip();
    const scale = Math.max(pw / img.width, ph / img.height);
    const dw = img.width * scale;
    const dh = img.height * scale;
    ctx.drawImage(img, px + (pw - dw) / 2, py + (ph - dh) / 2, dw, dh);
    ctx.restore();

    // text
    const tx = px + pw + 50;
    const tw = W - tx - 60;
    ctx.fillStyle = "#ffffff";
    ctx.textBaseline = "top";

    ctx.font = "bold 52px sans-serif";
    let y = portrait ? 150 : 210;
    for (const line of wrapLines(ctx, show, tw, 2)) {
      ctx.fillText(line, tx, y);
      y += 64;
    }

    ctx.fillStyle = "#7dd3fc";
    ctx.font = "34px sans-serif";
    y += 14;
    for (const line of wrapLines(ctx, episode, tw, 3)) {
      ctx.fillText(line, tx, y);
      y += 46;
    }

    ctx.fillStyle = "rgba(255,255,255,0.8)";
    ctx.font = "bold 28px sans-serif";
    ctx.fillText("SHAN MINI BOT", tx, H - 110);
    ctx.font = "22px sans-serif";
    ctx.fillText("Cartoon Zone", tx, H - 72);

    return canvas.toBuffer("image/jpeg");
  } catch (error) {
    console.error("❌ Cartoon card error:", error?.message || error);
    return null;
  }
}

/* =====================================================
MESSAGE BUILDERS
===================================================== */

const isSinhala = t => /sinhala|සිංහල/i.test(t);
const isSeries = t => /season|series|\bs\d{1,2}\b|episodes?/i.test(t);

function buildSearchList(label, items, page = 1) {
  const pages = Math.max(1, Math.ceil(items.length / LIST_PAGE));
  const from = (page - 1) * LIST_PAGE;
  const slice = items.slice(from, from + LIST_PAGE);

  let text = `🎬 *${MARKER_SEARCH}*\n${label}\n\n`;

  slice.forEach((m, i) => {
    const extra = [
      isSeries(m.title) ? "📺 Series" : "🎬 Movie",
      isSinhala(m.title) ? "🇱🇰 Sinhala Dubbed" : "🌐 Other"
    ].join(" • ");

    text += `*${from + i + 1}.* ${cleanTitle(m.title)}\n     ${extra}\n\n`;
  });

  text += `📩 *Reply* with a number to get details (${from + 1} - ${from + slice.length})`;

  if (pages > 1) {
    text += `\n📄 Page *${page}/${pages}*`;
    text += `\n➡️ Reply *n* = next page, *p* = previous page, *p3* = go to page 3`;
  }

  return { text, pages };
}

// sends one page of a list and remembers it so replies (number / n / p / p3) work
async function sendListPage(sock, msg, label, items, page = 1) {
  const pages = Math.max(1, Math.ceil(items.length / LIST_PAGE));
  const current = Math.min(Math.max(page, 1), pages);
  const built = buildSearchList(label, items, current);

  const sent = await sock.sendMessage(msg.key.remoteJid, { text: built.text }, { quoted: msg });

  remember(sent, { type: "search", chat: msg.key.remoteJid, items, label, page: current });
}

function buildEpisodeList(title, episodes) {
  const eps = episodes.slice(0, 300);
  let text = `📺 *${MARKER_EPISODES}*\n🎞️ ${title}\n\n`;

  eps.forEach((e, i) => {
    text += `*${i + 1}.* ${clip(e.title, 70)}\n`;
  });

  text += `\n📩 *Reply* with a number to get the download links (1 - ${eps.length})`;
  return { text, items: eps };
}

function buildDownloadList(title, items) {
  if (!items.length) {
    return {
      text: `📥 *${MARKER_DL}*\n🎞️ ${title}\n\n😕 No download links were found for this title.`,
      items: []
    };
  }

  let text = `📥 *${MARKER_DL}*\n🎞️ ${title}\n\n`;

  items.forEach((it, i) => {
    const head = [it.quality, it.size].filter(Boolean).join(" • ");
    const tooBig = it.sizeMB > MAX_MB;
    const tag = tooBig ? "🔗 Too big for WhatsApp (link only)" : "🚀 Direct";

    text += `*${i + 1}.* ${head}\n     ${tag}\n`;
  });

  text += `\n📩 *Reply* with a number to download (1 - ${items.length})`;
  text += `\n📄 Default: video file as *document*`;
  text += `\n🎞️ For a playable video reply like: *2 vid*  (document: *2 doc*)`;
  text += `\n⚠️ WhatsApp can only take files up to ~${Math.round((MAX_MB / 1024) * 10) / 10} GB, bigger ones are sent as a direct link.`;

  return { text, items };
}

/* =====================================================
DOWNLOAD ENGINE
===================================================== */

async function headSize(url) {
  try {
    const res = await fetch(url, {
      method: "HEAD",
      headers: { "User-Agent": UA, Referer: `${SITE}/` },
      redirect: "follow",
      signal: AbortSignal.timeout(8000)
    });
    const length = Number(res.headers.get("content-length") || 0);
    return res.ok && length ? length : 0;
  } catch {
    return 0;
  }
}

// Small JPEG thumbnail so the document shows a preview picture (needs @napi-rs/canvas)
async function getThumbnail(image) {
  try {
    if (!image) return null;

    const lib = await import("@napi-rs/canvas").catch(() => null);
    if (!lib) return null;

    const img = await lib.loadImage(await fetchBuffer(image));
    const scale = Math.min(200 / img.width, 200 / img.height, 1);
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));

    const canvas = lib.createCanvas(w, h);
    canvas.getContext("2d").drawImage(img, 0, 0, w, h);

    const buf = canvas.toBuffer("image/jpeg");
    return buf.length < 150 * 1024 ? buf : null;
  } catch {
    return null;
  }
}

async function downloadToTemp(url, file, maxMB) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "*/*", Referer: `${SITE}/` },
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

async function downloadItem(sock, msg, item, title = "", opts = {}) {
  const from = msg.key.remoteJid;

  if (store.busy.has(from)) {
    return say(sock, msg, "⏳ A download is already running in this chat. Please wait until it finishes.");
  }

  store.busy.add(from);

  try {
    await react(sock, msg, "⏳");

    const url = item.link;

    if (item.sizeMB > MAX_MB) {
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
      : `${safeName(`${title || "Cartoon"} ${quality}`)}.${ext}`;

    await say(
      sock,
      msg,
      `📤 *${title || fileName}* ${quality}\n⏳ Downloading... this can take a few minutes.`
    );

    cleanTempDir();

    // Upload needs the file + Baileys' encrypted copy, so ~2x the size must be free
    const needMB = (item.sizeMB || 0) * 2.1;
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

    const tmpFile = path.join(TMP_DIR, `cartoon_${Date.now()}.${ext}`);

    try {
      await downloadToTemp(url, tmpFile, MAX_MB);

      const caption = `🎬 ${title || fileName}${quality ? `\n💿 ${quality}` : ""}${item.size ? ` • ${item.size}` : ""}`;

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
      console.error("❌ cartoon download error:", error?.message || error);

      const diskFull = error?.code === "ENOSPC" || /ENOSPC/i.test(error?.message || "");
      const reason = error?.tooBig
        ? "The file is too big."
        : diskFull
        ? "The bot server's disk is full. Free some space (or set CARTOON_TMP_DIR to a bigger disk)."
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

/* =====================================================
FLOWS
===================================================== */

async function sendDownloadList(sock, msg, title, image, downloads) {
  // look up the file sizes so the list can show them
  const items = await Promise.all(
    downloads.slice(0, 99).map(async d => {
      const bytes = await headSize(d.url);
      return {
        quality: d.quality,
        link: d.url,
        size: formatSize(bytes),
        sizeMB: bytes / 1048576
      };
    })
  );

  const list = buildDownloadList(title, items);
  const sent = await sock.sendMessage(msg.key.remoteJid, { text: list.text }, { quoted: msg });

  if (list.items.length) {
    remember(sent, { type: "downloads", chat: msg.key.remoteJid, items: list.items, title, image });
  }
}

// episode card (thumbnail in the bot's style + description) → quality list
async function sendEpisodeCard(sock, msg, show, ep) {
  const from = msg.key.remoteJid;
  await react(sock, msg, "⏳");

  let detail;
  try {
    detail = await getEpisode(ep.id);
  } catch (error) {
    console.error("❌ cartoon episode error:", error?.message || error);
    await react(sock, msg, "❌");
    return say(sock, msg, "❌ Could not load this episode. Please try again in a moment.");
  }

  if (!detail.downloads.length) {
    await react(sock, msg, "❌");
    return say(sock, msg, "😕 No download links were found for this episode.");
  }

  const full = `${show.title} - ${ep.title}`;
  const lines = [`🎬 *${show.title}*`, `🎞️ ${ep.title}`];
  if (show.description) lines.push("", `📝 ${truncate(show.description, 350)}`);
  const caption = lines.join("\n");

  // single-item pages (movies) already had their card in the details step
  if (!show.skipCard) {
    let content = null;

    if (show.image) {
      const card = await buildCard({ image: show.image, show: show.title, episode: ep.title });
      content = card ? { image: card, caption } : { image: { url: show.image }, caption };
    }

    try {
      await sock.sendMessage(from, content || { text: caption }, { quoted: msg });
    } catch {
      await say(sock, msg, caption);
    }
  }

  await sendDownloadList(sock, msg, show.skipCard ? show.title : full, show.image, detail.downloads);
  await react(sock, msg, "✅");
}

async function sendDetails(sock, msg, item) {
  const from = msg.key.remoteJid;
  await react(sock, msg, "⏳");

  let details;
  try {
    details = await getCartoon(item.id);
  } catch (error) {
    console.error("❌ cartoon details error:", error?.message || error);
    await react(sock, msg, "❌");
    return say(sock, msg, `❌ ${error?.message || "Could not load the details. Please try again in a moment."}`);
  }

  const title = cleanTitle(details.title || item.title) || "Cartoon";
  const poster = details.image || item.image;
  const multi = details.episodes.length > 1;

  // 1) details card
  const lines = [`🎬 *${title}*`, ""];
  if (multi) lines.push(`🎞️ Episodes : ${details.episodes.length}`);
  if (isSinhala(details.title || item.title)) lines.push("🇱🇰 Sinhala Dubbed");
  if (details.description) lines.push("", `📝 ${truncate(details.description, 350)}`);
  const caption = lines.join("\n");

  try {
    if (!poster) throw new Error("no image");
    await sock.sendMessage(from, { image: { url: poster }, caption }, { quoted: msg });
  } catch {
    await say(sock, msg, caption);
  }

  const show = { title, image: poster, description: details.description };

  // 2) episodes (series) or straight to the download list (movie)
  if (multi) {
    const list = buildEpisodeList(title, details.episodes);
    const sent = await sock.sendMessage(from, { text: list.text }, { quoted: msg });
    remember(sent, { type: "episodes", chat: from, items: list.items, show });
  } else {
    const detail = await getEpisode(details.episodes[0].id);
    await sendDownloadList(sock, msg, title, poster, detail.downloads);
  }

  await react(sock, msg, "✅");
}

async function runSearch(sock, msg, query, prefix) {
  if (!query) {
    return say(
      sock,
      msg,
      `🎬 *CARTOON SEARCH*\n\nUsage: ${prefix}cartoon <cartoon / movie name>\nExample: ${prefix}cartoon Ben 10\n\nBrowse everything: ${prefix}cartoonlist`
    );
  }

  // a site link was pasted → go straight to details
  if (/^https?:\/\//i.test(query) && query.startsWith(SITE)) {
    return sendDetails(sock, msg, { id: query, title: "", image: "" });
  }

  await react(sock, msg, "🔎");

  let results;
  try {
    results = await searchCartoons(query);
  } catch (error) {
    console.error("❌ cartoon search error:", error?.message || error);
    await react(sock, msg, "❌");
    return say(sock, msg, "❌ Search failed. Please try again in a moment.");
  }

  if (!results.length) {
    return say(
      sock,
      msg,
      `😕 No results found for "${query}".\n\nTip: search with English letters, or browse with ${prefix}cartoonlist`
    );
  }

  await sendListPage(sock, msg, `🔎 Query: *${query}*`, results.slice(0, MAX_SHOW), 1);
}

async function runList(sock, msg, letter) {
  await react(sock, msg, "🔎");

  let results;
  try {
    results = await browseCartoons(letter);
  } catch (error) {
    console.error("❌ cartoon list error:", error?.message || error);
    await react(sock, msg, "❌");
    return say(sock, msg, "❌ Could not load the list. Please try again in a moment.");
  }

  if (!results.length) {
    return say(
      sock,
      msg,
      letter ? `😕 No cartoons found under "${letter.toUpperCase()}".` : "😕 No cartoons found."
    );
  }

  const shown = results.slice(0, MAX_LIST);
  const label = letter
    ? `🔤 Letter: *${letter.toUpperCase()}* • ${shown.length} found`
    : `📚 All cartoons: *${shown.length}*`;

  await sendListPage(sock, msg, label, shown, 1);
  await react(sock, msg, "✅");
}

/* =====================================================
PLUGIN
===================================================== */

export default {
  commands: ["cartoon", "cartoons", "cartoonlist"],

  // tells index.js to call handleReply() for replies to bot messages
  replyHandler: true,

  async execute(sock, msg, args, commandName) {
    const prefix = await getPrefix();
    const name = String(commandName || "").toLowerCase();
    const first = String(args[0] || "").toLowerCase();

    /* .cartoon debug <link> */
    if (first === "debug" && args[1]) {
      try {
        const d = await debugPage(args[1]);
        await say(sock, msg, `🔧 DEBUG\n\n${d.links}`);
        await say(sock, msg, `🔧 SNIPPET\n\n${d.snippet}`);
      } catch (error) {
        await say(sock, msg, `❌ ${error?.message || error}`);
      }
      return;
    }

    /* .cartoonlist  (everything)  |  .cartoonlist <letter>  |  .cartoon list [letter] */
    if (name === "cartoonlist" || first === "list") {
      const arg = name === "cartoonlist" ? args[0] : args[1];
      const letter = /^[a-z0-9]$/i.test(String(arg || "")) ? String(arg).toLowerCase() : "";
      return runList(sock, msg, letter);
    }

    /* .cartoon <name> */
    return runSearch(sock, msg, args.join(" ").trim(), prefix);
  },

  async handleReply(sock, msg, text) {
    const input = String(text || "").trim().toLowerCase();
    const pageCmd = input.match(/^(?:(n|next|p|prev|previous)|p\s?(\d{1,3}))$/);

    /* n / p / p3 → another page of a list */
    if (pageCmd) {
      const entry = store.byMsg.get(stanzaIdOf(msg));

      if (!entry || entry.chat !== msg.key.remoteJid || entry.type !== "search") return false;

      const pages = Math.max(1, Math.ceil(entry.items.length / LIST_PAGE));
      let target = entry.page;

      if (pageCmd[2]) target = parseInt(pageCmd[2], 10);
      else if (pageCmd[1].startsWith("n")) target = entry.page + 1;
      else target = entry.page - 1;

      if (target < 1 || target > pages) {
        await say(sock, msg, `❌ Page ${target} does not exist (1 - ${pages}).`);
        return true;
      }

      await sendListPage(sock, msg, entry.label, entry.items, target);
      return true;
    }

    const parsed = String(text || "").trim().match(/^(\d{1,3})(?:\s*(doc|document|d|vid|video|v))?$/i);
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
        await sendEpisodeCard(sock, msg, entry.show, item);
      } else if (entry.type === "downloads") {
        await downloadItem(sock, msg, item, entry.title, { mode, image: entry.image });
      }
    } catch (error) {
      console.error("❌ cartoon reply error:", error?.stack || error?.message || error);
      await say(sock, msg, `❌ Something went wrong: ${error?.message || "unknown error"}`);
    }

    return true;
  }
};
