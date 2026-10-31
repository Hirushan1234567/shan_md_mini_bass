// dlcore.js  (next to index.js, in the root folder, NOT inside plugins/)
// SHAN MINI BOT V1 — shared engine for tiktok.js / facebook.js / youtube.js / instagram.js
//
//   .tt <link>  →  card (title, author, qualities)  →  reply 2     → "send as" 1 Video / 2 Document
//                                                   →  reply 2d    → quality 2 straight as Document
//                                                   →  reply 2v    → quality 2 straight as Video
//
// Sources (in this order):
//   TikTok    : tikwm.com API            → yt-dlp
//   YouTube   : SaveTube (same as song)  → yt-dlp
//   Facebook  : yt-dlp
//   Instagram : yt-dlp
//
// yt-dlp: .env YTDLP_PATH=/path/to/yt-dlp — otherwise it is auto-downloaded from GitHub to ./bin/yt-dlp.
// Optional .env:
//   DL_MAX_MB=100            largest file the bot will send (MB)
//   YTDLP_COOKIES=./cookies.txt   (login cookies for Instagram / private Facebook — Netscape format)

import fs from "fs";
import os from "os";
import path from "path";
import { spawn } from "child_process";
import { Readable, Transform } from "stream";
import { pipeline } from "stream/promises";
import mongoose from "mongoose";
// lang.js can be in the root folder (next to index.js) or next to this file
const { t, langOf } = await import("./lang.js").catch(() => import("../lang.js"));

/* =====================================================
CONFIG
===================================================== */

export const MAX_MB = Number(process.env.DL_MAX_MB || 100);
export const MAX_BYTES = MAX_MB * 1024 * 1024;

const CACHE_TTL = 30 * 60 * 1000;

// Falls back to ./tmp-dl on panels where /tmp is not writable
const TMP_DIR = (() => {
  for (const dir of [path.join(os.tmpdir(), "shan-dl"), path.join(process.cwd(), "tmp-dl")]) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.accessSync(dir, fs.constants.W_OK);
      return dir;
    } catch {}
  }
  return path.join(process.cwd(), "tmp-dl");
})();

export const UA =
  "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36";

const store = new Map(); // bot message id -> { stage, chat, time, info, option? }
const busy = new Set(); // chats with a download running

try { fs.mkdirSync(TMP_DIR, { recursive: true }); } catch {}

// Clean up old temp files (older than one hour)
try {
  for (const f of fs.readdirSync(TMP_DIR)) {
    const full = path.join(TMP_DIR, f);
    if (Date.now() - fs.statSync(full).mtimeMs > 60 * 60 * 1000) fs.rmSync(full, { force: true });
  }
} catch {}

/* =====================================================
HELPERS
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

export function safeName(name = "") {
  return (
    String(name)
      .replace(/[\\/:*?"<>|\n\r]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || "media"
  );
}

const mb = bytes => (bytes / 1024 / 1024).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1);

function fmtDuration(sec) {
  const s = Math.round(Number(sec) || 0);
  if (!s) return "N/A";

  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;

  return h
    ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`
    : `${m}:${String(r).padStart(2, "0")}`;
}

function fail(message, code) {
  const error = new Error(message);
  if (code) error.code = code;
  return error;
}

// If a command was made Premium-only (.premiumco tiktok), number replies are protected too
async function replyAllowed(sock, msg, commands) {
  try {
    if (mongoose.connection.readyState !== 1) return true;

    const doc = await mongoose.connection
      .collection("premiumsettings")
      .findOne({ _id: "premium_commands" });

    const list = (doc?.commands || []).map(c => String(c).toLowerCase());

    if (!commands.some(c => list.includes(c))) return true;

    if (globalThis.SHAN_IS_OWNER_MSG?.(msg)) return true;

    const sender = globalThis.SHAN_GET_SENDER?.(msg) || "";

    if (typeof globalThis.SHAN_IS_ADMIN === "function" && sender) {
      if (await globalThis.SHAN_IS_ADMIN(sender)) return true;
    }

    if (typeof globalThis.isPremiumUser !== "function") return false;

    const botId = msg?.__shanSub
      ? String(msg.__shanSub).replace(/\D/g, "") || "sub"
      : "main";

    return Boolean(await globalThis.isPremiumUser(sender, botId));
  } catch {
    return false;
  }
}

/* =====================================================
FILE DOWNLOAD  (stream → disk, validated)
Streams to disk instead of buffering in RAM — panels have little memory.
===================================================== */

export function sniff(buf) {
  if (!buf || buf.length < 12) return "unknown";

  if (buf.subarray(4, 8).toString("latin1") === "ftyp") return "mp4"; // mp4 / m4a
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return "webm";
  if (buf.subarray(0, 3).toString("latin1") === "ID3") return "mp3";
  if (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return "mp3";
  if (buf.subarray(0, 4).toString("latin1") === "OggS") return "ogg";

  return "unknown";
}

function newTmpBase() {
  return path.join(TMP_DIR, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
}

export function cleanup(file) {
  try {
    if (file) fs.rmSync(file, { force: true });
  } catch {}
}

// returns { file, kind, bytes }
export async function downloadToFile(url, { headers = {}, timeout = 5 * 60 * 1000 } = {}) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, ...headers },
    signal: AbortSignal.timeout(timeout)
  });

  if (!res.ok) throw fail(`Download failed (${res.status})`);
  if (!res.body) throw fail("Empty response");

  const type = res.headers.get("content-type") || "no content-type";
  const length = Number(res.headers.get("content-length") || 0);

  if (length > MAX_BYTES) throw fail(String(length), "TOO_LARGE");

  const base = newTmpBase();
  const part = `${base}.part`;

  let bytes = 0;

  const counter = new Transform({
    transform(chunk, _enc, cb) {
      bytes += chunk.length;
      if (bytes > MAX_BYTES) return cb(fail(String(bytes), "TOO_LARGE"));
      cb(null, chunk);
    }
  });

  try {
    await pipeline(Readable.fromWeb(res.body), counter, fs.createWriteStream(part));
  } catch (error) {
    cleanup(part);

    // Connection dropped ("terminated", "aborted" ...) — give a readable message
    if (error?.code === "TOO_LARGE") throw error;
    throw fail(`Download was interrupted (${error?.cause?.code || error?.message || "network error"})`);
  }

  const head = Buffer.alloc(16);
  const fd = fs.openSync(part, "r");
  fs.readSync(fd, head, 0, 16, 0);
  fs.closeSync(fd);

  const kind = sniff(head);

  console.log(`[DL] downloaded ${bytes} bytes | ${type} | ${kind}`);

  // Not audio / video (a JSON / HTML error page) — this is how tiny unplayable files happen
  if (kind === "unknown") {
    const peek = fs.readFileSync(part).subarray(0, 120).toString("utf8").replace(/\s+/g, " ").trim();
    console.error(`[DL] not a media file. First bytes: ${JSON.stringify(peek)}`);
    cleanup(part);
    throw fail("The download server sent an invalid file");
  }

  if (length && bytes < length) {
    cleanup(part);
    throw fail(`Download was cut off (${bytes}/${length} bytes)`);
  }

  if (bytes < 10 * 1024) {
    cleanup(part);
    throw fail("The file is too small to be valid");
  }

  const file = `${base}.${kind === "webm" ? "webm" : kind === "mp3" ? "mp3" : kind === "ogg" ? "ogg" : "mp4"}`;
  fs.renameSync(part, file);

  return { file, kind, bytes };
}

/* =====================================================
YT-DLP  (Facebook / Instagram / fallback)
===================================================== */

let ytdlpPromise = null;

function runBinary(bin, args, { timeout = 15000, capture = true } = {}) {
  return new Promise((resolve, reject) => {
    let child;

    try {
      child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      return reject(error);
    }

    let out = "";
    let err = "";
    let size = 0;

    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch {}
      reject(fail("The downloader timed out", "TIMEOUT"));
    }, timeout);

    child.stdout.on("data", chunk => {
      size += chunk.length;
      if (capture && size < 30 * 1024 * 1024) out += chunk;
    });

    child.stderr.on("data", chunk => {
      err = (err + chunk).slice(-4000);
    });

    child.on("error", error => {
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", code => {
      clearTimeout(timer);

      if (code === 0) return resolve(out);

      const msg = err.split("\n").filter(Boolean).pop() || `exit code ${code}`;
      const clean = msg.replace(/^ERROR:\s*/i, "").replace(/\x1b\[[0-9;]*m/g, "").slice(0, 300);

      const error = fail(clean, /login|log in|cookies|private|restricted|age|sign in|not available|unavailable/i.test(clean) ? "PRIVATE" : undefined);
      reject(error);
    });
  });
}

async function binWorks(bin) {
  try {
    await runBinary(bin, ["--version"], { timeout: 20000 });
    return true;
  } catch {
    return false;
  }
}

async function installYtdlp() {
  const exe = process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp";

  const candidates = [
    process.env.YTDLP_PATH,
    path.join(process.cwd(), "bin", exe),
    "yt-dlp"
  ].filter(Boolean);

  for (const bin of candidates) {
    if (await binWorks(bin)) return bin;
  }

  // Download the standalone binary from GitHub (no Python needed)
  const asset =
    process.platform === "win32" ? "yt-dlp.exe"
    : process.platform === "darwin" ? "yt-dlp_macos"
    : process.arch === "arm64" ? "yt-dlp_linux_aarch64"
    : "yt-dlp_linux";

  const dest = path.join(process.cwd(), "bin", exe);
  fs.mkdirSync(path.dirname(dest), { recursive: true });

  console.log(`[DL] yt-dlp not found — downloading ${asset} ...`);

  try {
    const res = await fetch(`https://github.com/yt-dlp/yt-dlp/releases/latest/download/${asset}`, {
      signal: AbortSignal.timeout(3 * 60 * 1000)
    });

    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

    await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(dest));
    fs.chmodSync(dest, 0o755);

    if (!(await binWorks(dest))) throw new Error("the downloaded binary does not run on this server");

    console.log("[DL] yt-dlp installed:", dest);
    return dest;
  } catch (error) {
    cleanup(dest);
    throw fail(error?.message || String(error), "NO_YTDLP");
  }
}

// Check whether this yt-dlp supports the newer flags (JS runtime / EJS)
let ytdlpExtra = [];

async function probeYtdlp(bin) {
  try {
    const help = await runBinary(bin, ["--help"], { timeout: 20000 });
    const extra = [];

    // Use Node.js to solve YouTube signatures
    if (/--js-runtimes/.test(help)) extra.push("--js-runtimes", "node");
    if (/--remote-components/.test(help)) extra.push("--remote-components", "ejs:github");

    ytdlpExtra = extra;
  } catch {}
}

// When YouTube blocks us, update yt-dlp (at most once every 6 hours) and retry
let lastYtdlpUpdate = 0;

async function ytdlpSelfUpdate() {
  if (Date.now() - lastYtdlpUpdate < 6 * 60 * 60 * 1000) return false;
  lastYtdlpUpdate = Date.now();

  try {
    const bin = await getYtdlp();
    await runBinary(bin, ["-U"], { timeout: 2 * 60 * 1000 });
    await probeYtdlp(bin);
    console.log("[DL] yt-dlp updated");
    return true;
  } catch (error) {
    console.error("[DL] yt-dlp update failed:", error?.message || error);
    return false;
  }
}

async function withYtdlpRetry(fn) {
  try {
    return await fn();
  } catch (error) {
    if (error?.code === "PRIVATE") {
      console.error("[DL] yt-dlp blocked/login error:", error.message);
      if (await ytdlpSelfUpdate()) return await fn();
    }
    throw error;
  }
}

function getYtdlp() {
  if (!ytdlpPromise) {
    ytdlpPromise = installYtdlp().then(async bin => { await probeYtdlp(bin); return bin; }).catch(error => {
      ytdlpPromise = null; // try again next time
      throw error;
    });
  }

  return ytdlpPromise;
}

function ytdlpBaseArgs() {
  const args = [
    "--no-warnings", "--no-playlist", "--socket-timeout", "20", "--retries", "3",
    ...ytdlpExtra,
    // For YouTube bot checks: use different player clients (override with .env YTDLP_YT_CLIENTS)
    "--extractor-args", `youtube:player_client=${process.env.YTDLP_YT_CLIENTS || "default,mweb,tv"}`
  ];
  const cookies = process.env.YTDLP_COOKIES;

  if (cookies && fs.existsSync(cookies)) args.push("--cookies", cookies);

  return args;
}

/* ---------- Quality tiers ----------
   Portrait videos report their LONG side as "height" (540x960 → 960),
   so we classify by the SHORT side instead. That gives the standard
   144 / 240 / 360 / 480 / 720 / 1080 labels for both portrait and landscape.
   The real height (dh) is kept for the actual download selector. */

const QUALITY_TIERS = [144, 240, 360, 480, 720, 1080];

function tierOf(f) {
  const short = f.width && f.height ? Math.min(f.width, f.height) : f.height;
  let tier = 0;

  for (const x of QUALITY_TIERS) {
    if (short >= x * 0.95) tier = x; // 5% tolerance (e.g. 682 wide still counts as 720)
  }

  return tier;
}

export const ytdlpInfo = url => withYtdlpRetry(() => ytdlpInfoRaw(url));

async function ytdlpInfoRaw(url) {
  const bin = await getYtdlp();
  const raw = await runBinary(bin, [...ytdlpBaseArgs(), "-J", url], { timeout: 90 * 1000 });

  let info = JSON.parse(raw);

  // carousel / playlist — use the first item
  if (Array.isArray(info.entries) && info.entries.length) {
    const first = info.entries.find(e => e && (e.formats?.length || e.url)) || info.entries[0];
    info = { ...first, title: first.title || info.title, uploader: first.uploader || info.uploader };
  }

  const videoFormats = (info.formats || []).filter(f => f.vcodec && f.vcodec !== "none" && f.height);

  const sizes = new Map(); // tier -> { size, dh }

  for (const f of videoFormats) {
    const tier = tierOf(f);
    if (!tier) continue;

    const cur = sizes.get(tier) || { size: 0, dh: 0 };
    cur.size = Math.max(cur.size, f.filesize || f.filesize_approx || 0);
    cur.dh = Math.max(cur.dh, f.height); // real height, used by the download selector
    sizes.set(tier, cur);
  }

  let heights = [...sizes.entries()]
    .sort((a, b) => b[0] - a[0])
    .slice(0, 5)
    .map(([h, v]) => ({ h, size: v.size, dh: v.dh }));

  // No standard tier matched (below 144 or odd sizes) — use the best available
  if (!heights.length && videoFormats.length) {
    const best = videoFormats.reduce((a, b) => (b.height > a.height ? b : a));
    const short = best.width ? Math.min(best.width, best.height) : best.height;
    heights = [{ h: short, size: best.filesize || best.filesize_approx || 0, dh: best.height }];
  }

  // Single-stream posts with no quality list
  if (!heights.length && (info.url || info.formats?.length)) heights = [{ h: 0, size: 0, dh: 0 }];

  return {
    title: info.title || "",
    author: info.uploader || info.channel || info.creator || "",
    duration: info.duration || 0,
    thumbnail: info.thumbnail || "",
    heights,
    isImage: !heights.length && Boolean(info.thumbnail)
  };
}

export const ytdlpDownload = (url, opts = {}) => withYtdlpRetry(() => ytdlpDownloadRaw(url, opts));

async function ytdlpDownloadRaw(url, { height = 0, audio = false } = {}) {
  const bin = await getYtdlp();
  const id = path.basename(newTmpBase());
  const out = path.join(TMP_DIR, `${id}.%(ext)s`);

  const run = args =>
    runBinary(bin, [...ytdlpBaseArgs(), "--max-filesize", String(MAX_BYTES), "-o", out, ...args, url], {
      timeout: 10 * 60 * 1000,
      capture: false
    });

  try {
    if (audio) {
      try {
        await run(["-f", "bestaudio", "-x", "--audio-format", "mp3"]);
      } catch (error) {
        if (error.code === "PRIVATE") throw error;
        // No ffmpeg — keep the original m4a without converting
        await run(["-f", "bestaudio[ext=m4a]/bestaudio"]);
      }
    } else {
      const h = height || 4320;

      // Prefer a single mp4 stream (no ffmpeg needed), otherwise merge video + audio
      // Prefer H.264 (avc1) + AAC (mp4a) — the only combo WhatsApp always plays
      const selector =
        `b[height<=${h}][ext=mp4][vcodec^=avc1][acodec^=mp4a]/` +
        `bv*[height<=${h}][vcodec^=avc1]+ba[ext=m4a]/` +
        `b[height<=${h}][ext=mp4]/` +
        `bv*[height<=${h}]+ba/` +
        `b[height<=${h}]/b`;

      await run(["-f", selector, "--merge-output-format", "mp4"]);
    }
  } catch (error) {
    // Remove broken / half-finished files
    for (const f of fs.readdirSync(TMP_DIR)) if (f.startsWith(id)) cleanup(path.join(TMP_DIR, f));

    if (/larger than max-filesize|max-filesize/i.test(error.message)) {
      throw fail("0", "TOO_LARGE");
    }

    throw error;
  }

  const files = fs
    .readdirSync(TMP_DIR)
    .filter(f => f.startsWith(`${id}.`) && !/\.(part|ytdl)$/.test(f))
    .map(f => path.join(TMP_DIR, f));

  if (!files.length) throw fail("The downloader produced no file");

  let file = files.sort((a, b) => fs.statSync(b).size - fs.statSync(a).size)[0];

  // Video: make sure it is H.264 + AAC with the moov atom up front (needs ffmpeg/ffprobe)
  if (!audio) file = await makeWhatsappSafe(file);

  const bytes = fs.statSync(file).size;

  if (bytes > MAX_BYTES) {
    cleanup(file);
    throw fail(String(bytes), "TOO_LARGE");
  }

  const ext = path.extname(file).slice(1).toLowerCase();

  return { file, bytes, kind: ext === "webm" ? "webm" : ext === "mp3" ? "mp3" : ext === "m4a" ? "m4a" : "mp4" };
}

// Re-mux / re-encode a downloaded video so WhatsApp can play it.
// - H.264 video is copied as is, anything else (VP9 / AV1 / HEVC) is converted
// - Audio is converted to AAC when needed
// - "+faststart" moves the moov atom to the front (fixes "something is wrong with the video file")
// If ffmpeg / ffprobe are missing, the original file is returned unchanged.
async function makeWhatsappSafe(file) {
  const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
  const ffprobe = process.env.FFPROBE_PATH || "ffprobe";

  let vcodec = "";
  let acodec = "";

  try {
    const raw = await runBinary(
      ffprobe,
      ["-v", "error", "-show_entries", "stream=codec_type,codec_name", "-of", "json", file],
      { timeout: 30000 }
    );

    for (const s of JSON.parse(raw).streams || []) {
      if (s.codec_type === "video" && !vcodec) vcodec = s.codec_name;
      if (s.codec_type === "audio" && !acodec) acodec = s.codec_name;
    }
  } catch {
    console.error("[DL] ffprobe not available — skipping the compatibility check");
    return file;
  }

  if (!vcodec) return file;

  const videoOk = vcodec === "h264";
  const audioOk = !acodec || acodec === "aac";
  const out = file.replace(/\.[^.]+$/, "") + ".wa.mp4";

  const args = [
    "-y", "-i", file,
    "-map", "0:v:0", "-map", "0:a:0?",
    "-c:v", videoOk ? "copy" : "libx264",
    ...(videoOk ? [] : ["-preset", "veryfast", "-crf", "26", "-pix_fmt", "yuv420p"]),
    "-c:a", audioOk ? "copy" : "aac",
    "-movflags", "+faststart",
    out
  ];

  try {
    await runBinary(ffmpeg, args, { timeout: 5 * 60 * 1000, capture: false });
    console.log(`[DL] remuxed for WhatsApp (video: ${vcodec}, audio: ${acodec || "none"})`);
    cleanup(file);
    return out;
  } catch (error) {
    console.error("[DL] ffmpeg remux failed:", error?.message || error);
    cleanup(out);
    return file;
  }
}

// yt-dlp options (Facebook / Instagram / fallback) — info = ytdlpInfo(...) result
export function ytdlpOptions(url, info) {
  const options = [];

  for (const { h, size, dh } of info.heights) {
    options.push({
      kind: "video",
      label: h ? `${h}p` : "Video",
      size,
      get: () => ytdlpDownload(url, { height: dh || h }) // real height for the selector
    });
  }

  if (info.isImage && info.thumbnail) {
    options.push({ kind: "images", label: "", size: 0, get: async () => ({ images: [info.thumbnail] }) });
  } else if (info.heights.length) {
    options.push({ kind: "audio", label: "MP3", size: 0, get: () => ytdlpDownload(url, { audio: true }) });
  }

  return options;
}

/* =====================================================
PLUGIN FACTORY
===================================================== */

function mimeOf(kind, wantAudio) {
  if (wantAudio) return kind === "mp3" ? "audio/mpeg" : kind === "ogg" ? "audio/ogg" : "audio/mp4";
  return kind === "webm" ? "video/webm" : "video/mp4";
}

function friendlyError(error, lang) {
  const msg = String(error?.message || error || "Unknown error");

  if (error?.code === "TOO_LARGE") {
    const size = Number(msg);
    return t("dl.too_large", lang, { max: MAX_MB, size: size ? `${mb(size)}MB` : `>${MAX_MB}MB` });
  }

  if (error?.code === "PRIVATE") return t("dl.private", lang);
  if (error?.code === "NO_YTDLP") return t("dl.no_tool", lang, { msg: msg.slice(0, 120) });

  return t("dl.fail", lang, { msg: msg.slice(0, 200) });
}

// Quality label: "720p" -> "720 💎" (drops the "p" and adds an emoji)
function prettyQuality(label = "") {
  const q = Number(String(label).replace(/\D/g, ""));
  if (!q) return label;
  const tier = q >= 1080 ? "🔥" : q >= 720 ? "💎" : q >= 480 ? "✨" : q >= 360 ? "📺" : "📱";
  return `${q} ${tier}`;
}

function buildCard(cfg, info, lang) {
  const rows = info.options.map((o, i) => {
    const icon = o.kind === "audio" ? "🎵" : o.kind === "images" ? "🖼️" : "🎬";

    const label =
      o.kind === "audio" ? t("dl.opt_audio", lang)
      : o.kind === "images" ? t("dl.opt_images", lang)
      : prettyQuality(o.label);

    let extra = "";
    if (o.size > MAX_BYTES) extra = `  ⚠️ ${mb(o.size)}MB`;
    else if (o.size) extra = `  ~${mb(o.size)}MB`;

    return `┃ 〔 ${i + 1} 〕 ${icon} ${label}${extra}`;
  });

  const title = String(info.title || "").replace(/\s+/g, " ").trim().slice(0, 90) || "—";

  return (
`╭━━━〔 ${cfg.icon} SHAN ${cfg.title} 〕━━━╮\n` +
`┃ 🎧 ${t("dl.info", lang)}\n` +
`┣━━━━━━━━━━━━━━━━━━━\n` +
`┃ 📝 ${t("dl.f_title", lang)} : ${title}\n` +
`┃ 👤 ${t("dl.f_author", lang)} : ${info.author || "Unknown"}\n` +
(info.duration ? `┃ ⏱️ ${t("dl.f_duration", lang)} : ${fmtDuration(info.duration)}\n` : "") +
`┣━━━━━━━━━━━━━━━━━━━\n` +
`┃ 💎 ${t("dl.select", lang)}\n` +
`┃\n` +
rows.join("\n") + `\n` +
`┃\n` +
`┣━━━━━━━━━━━━━━━━━━━\n` +
`┃ ${t("dl.reply1", lang)}\n` +
`┃ ${t("dl.reply2", lang)}\n` +
`╰━━━━━━━━━━━━━━━━━━━╯\n\n` +
`⚡ 𝐏𝐎𝐖𝐄𝐑𝐄𝐃 𝐁𝐘 SHAN MINI BOT 👨‍💻`
  );
}

function buildTypeCard(option, lang) {
  const audio = option.kind === "audio";
  const label = audio ? t("dl.opt_audio", lang) : prettyQuality(option.label);

  return (
`╭━━━〔 📤 ${t("dl.send_as", lang)} 〕━━━╮\n` +
`┃ ${audio ? "🎵" : "🎬"} ${label}\n` +
`┣━━━━━━━━━━━━━━━━━━━\n` +
`┃ 〔 1 〕 ${audio ? "🎵 " + t("dl.type_audio", lang) : "🎬 " + t("dl.type_video", lang)}\n` +
`┃ 〔 2 〕 📄 ${t("dl.type_doc", lang)}\n` +
`┣━━━━━━━━━━━━━━━━━━━\n` +
`┃ ${t("dl.reply12", lang)}\n` +
`╰━━━━━━━━━━━━━━━━━━━╯`
  );
}

async function sendOption(sock, msg, entry, option, asDocument, lang) {
  const jid = msg.key.remoteJid;

  if (option.size > MAX_BYTES) {
    return say(sock, msg, friendlyError(fail(String(option.size), "TOO_LARGE"), lang));
  }

  if (busy.has(jid)) return say(sock, msg, t("dl.busy", lang));

  busy.add(jid);

  let out = null;

  try {
    await react(sock, msg, "⏳");

    out = await option.get();

    if (out.images) {
      for (const url of out.images.slice(0, 10)) {
        await sock.sendMessage(jid, { image: { url } }, { quoted: msg });
      }
    } else {
      const wantAudio = option.kind === "audio";
      const mime = mimeOf(out.kind, wantAudio);
      const ext = out.kind === "m4a" ? "m4a" : path.extname(out.file).slice(1) || "mp4";
      const name = `${safeName(entry.info.title)}${option.label && !wantAudio ? ` ${option.label}` : ""}.${ext}`;
      const media = { url: out.file }; // streamed from disk

      if (asDocument) {
        await sock.sendMessage(
          jid,
          { document: media, mimetype: mime, fileName: name, caption: `${wantAudio ? "🎵" : "🎬"} ${safeName(entry.info.title)}` },
          { quoted: msg }
        );
      } else if (wantAudio) {
        await sock.sendMessage(jid, { audio: media, mimetype: mime }, { quoted: msg });
      } else {
        await sock.sendMessage(
          jid,
          { video: media, mimetype: mime, caption: `🎬 ${safeName(entry.info.title)}` },
          { quoted: msg }
        );
      }
    }

    await react(sock, msg, "✅");
  } catch (error) {
    console.error(`[DL:${entry.cfg}] send error:`, error?.stack || error?.message || error);
    await react(sock, msg, "❌");
    await say(sock, msg, friendlyError(error, lang));
  } finally {
    busy.delete(jid);
    cleanup(out?.file);
  }
}

/**
 * cfg = {
 *   title: "TIKTOK", icon: "🎵", example: "https://vt.tiktok.com/xxxx",
 *   commands: ["tiktok","tt"],
 *   match(text) → url | null,
 *   prepare?(text) → url | null   (async; e.g. YouTube search)
 *   resolve(url) → { title, author, duration, thumbnail, options:[{kind,label,size,get}] }
 * }
 */
export function createDownloader(cfg) {
  const commands = cfg.commands.map(c => c.toLowerCase());

  return {
    command: commands[0],
    commands,
    replyHandler: true,

    async execute(sock, msg, args = [], commandName) {
      const lang = await langOf(msg);
      const prefix = await getPrefix();
      const text = args.join(" ").trim();
      const used = String(commandName || commands[0]);

      if (!text) {
        return say(
          sock,
          msg,
          t("dl.usage", lang, { icon: cfg.icon, title: cfg.title, p: prefix, cmd: used, example: cfg.example })
        );
      }

      await react(sock, msg, "🔎");

      try {
        const url = cfg.prepare ? await cfg.prepare(text) : cfg.match(text);

        if (!url) {
          await react(sock, msg, "❌");
          return say(sock, msg, t("dl.invalid_link", lang, { title: cfg.title }));
        }

        const info = await cfg.resolve(url);

        if (!info?.options?.length) throw fail("Nothing to download");

        const caption = buildCard(cfg, info, lang);

        let sent;

        try {
          if (!info.thumbnail) throw new Error("no thumbnail");
          sent = await sock.sendMessage(msg.key.remoteJid, { image: { url: info.thumbnail }, caption }, { quoted: msg });
        } catch {
          sent = await say(sock, msg, caption);
        }

        // Drop old entries
        const now = Date.now();
        for (const [id, e] of store) if (now - e.time > CACHE_TTL) store.delete(id);
        while (store.size > 300) store.delete(store.keys().next().value);

        if (sent?.key?.id) {
          store.set(sent.key.id, { stage: 1, cfg: cfg.title, commands, chat: msg.key.remoteJid, time: now, info });
        }

        await react(sock, msg, "✅");
      } catch (error) {
        console.error(`[DL:${cfg.title}] resolve error:`, error?.stack || error?.message || error);
        await react(sock, msg, "❌");
        return say(sock, msg, friendlyError(error, lang));
      }
    },

    async handleReply(sock, msg, text) {
      const value = String(text || "").trim().toLowerCase();
      const quotedId = stanzaIdOf(msg);
      const entry = store.get(quotedId);

      // Not a reply to one of our cards → let another plugin handle it
      if (!entry || entry.chat !== msg.key.remoteJid || !entry.commands.some(c => commands.includes(c))) {
        return false;
      }

      /* ---------- Stage 1: quality ---------- */
      if (entry.stage === 1) {
        const m = value.match(/^(\d{1,2})\s*(d|doc|document|v|video|a|audio)?$/);
        if (!m) return false;

        const lang = await langOf(msg);

        if (Date.now() - entry.time > CACHE_TTL) {
          store.delete(quotedId);
          await say(sock, msg, t("common.expired", lang));
          return true;
        }

        if (!(await replyAllowed(sock, msg, entry.commands))) {
          await say(sock, msg, t("dl.premium", lang));
          return true;
        }

        const option = entry.info.options[Number(m[1]) - 1];

        if (!option) {
          await say(sock, msg, t("dl.bad_number", lang, { n: entry.info.options.length }));
          return true;
        }

        const letter = m[2];

        // "2d" / "2v" — send straight away
        if (letter) {
          await sendOption(sock, msg, entry, option, /^d/.test(letter), lang);
          return true;
        }

        // photos — there is no video/document choice
        if (option.kind === "images") {
          await sendOption(sock, msg, entry, option, false, lang);
          return true;
        }

        const sent = await say(sock, msg, buildTypeCard(option, lang));

        if (sent?.key?.id) {
          store.set(sent.key.id, { ...entry, stage: 2, option, time: Date.now() });
        }

        return true;
      }

      /* ---------- Stage 2: video / document ---------- */
      const m = value.match(/^(1|2|v|d|a|video|audio|doc|document)$/);
      if (!m) return false;

      const lang = await langOf(msg);

      if (Date.now() - entry.time > CACHE_TTL) {
        store.delete(quotedId);
        await say(sock, msg, t("common.expired", lang));
        return true;
      }

      if (!(await replyAllowed(sock, msg, entry.commands))) {
        await say(sock, msg, t("dl.premium", lang));
        return true;
      }

      await sendOption(sock, msg, entry, entry.option, /^(2|d|doc|document)$/.test(m[1]), lang);
      return true;
    }
  };
}

/* =====================================================
URL HELPERS
===================================================== */

export function firstUrl(text = "") {
  return String(text).match(/https?:\/\/[^\s<>"']+/i)?.[0] || null;
}

export function videoIdFromUrl(text = "") {
  return (
    String(text).match(
      /(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:\S*&)?v=|shorts\/|embed\/|live\/)|music\.youtube\.com\/watch\?(?:\S*&)?v=)([a-zA-Z0-9_-]{11})/
    )?.[1] || ""
  );
}
