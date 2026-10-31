// plugins/youtube.js — SHAN MINI BOT V1 : YouTube video downloader
//
//   .yt <name | youtube link>  ->  card  ->  reply a number:
//      1 = Video 720p   2 = Video 480p   3 = Video 360p   4 = Document 720p
//
// Source 1: Chamindu API (song.js eke wage)   Source 2: SaveTube (fallback)
// dlcore.js / yt-dlp ONE NAHA — "private / age-restricted" error eka awe nathi wenawa.
// .env: CHAMA_API_KEY=...   (optional: YT_MAX_MB=90  YT_MAX_MIN=60)

import axios from "axios";
import { createDecipheriv } from "crypto";

const API_BASE = process.env.YT_API_BASE || "https://api.chamindu.site/api/v1/youtube";
const API_KEY = process.env.CHAMA_API_KEY || "";
const FOOTER = "POWERED BY SHAN MINI BOT";

const MAX_MB = Number(process.env.YT_MAX_MB || 90);
const MAX_MINUTES = Number(process.env.YT_MAX_MIN || 60);
const MARKER = "SELECT VIDEO QUALITY";
const CACHE_TIME = 10 * 60 * 1000;

const OPTIONS = [
    { n: 1, h: 720, doc: false, label: "🎬 Video 720p" },
    { n: 2, h: 480, doc: false, label: "🎬 Video 480p" },
    { n: 3, h: 360, doc: false, label: "🎬 Video 360p" },
    { n: 4, h: 720, doc: true, label: "📄 Document 720p" }
];

const UA =
    "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";

/* =====================================================
   HELPERS
===================================================== */

const str = v => (typeof v === "string" || typeof v === "number" ? String(v).trim() : "");
const isHttp = v => typeof v === "string" && /^https?:\/\//i.test(v);
const getJid = msg => msg?.key?.remoteJid;
const newId = () => Math.random().toString(36).slice(2, 8);

const ytIdFromText = t =>
    (String(t || "").match(
        /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|live\/|embed\/)|youtu\.be\/)([\w-]{11})/i
    ) || [])[1] || "";

function fmtDur(d) {
    const s = str(d);
    if (!s) return "N/A";
    if (!/^\d+$/.test(s)) return s;
    const n = Number(s);
    const h = Math.floor(n / 3600), m = Math.floor((n % 3600) / 60), sec = String(n % 60).padStart(2, "0");
    return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

function fmtViews(v) {
    const s = str(v);
    if (!s) return "N/A";
    if (!/^\d+$/.test(s)) return s;
    const n = Number(s);
    if (n >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, "") + "B";
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
    if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, "") + "K";
    return s;
}

// "4:47" / "1:02:03" / 287 -> seconds
function toSeconds(d) {
    const s = str(d);
    if (!s) return 0;
    if (/^\d+$/.test(s)) return Number(s);
    return s.split(":").reduce((a, p) => a * 60 + (Number(p) || 0), 0);
}

const field = {
    id: o => str(o?.videoId || o?.id || o?.video_id),
    title: o => str(o?.title || o?.name),
    author: o => str(o?.author?.name || o?.author || o?.channel || o?.uploader),
    duration: o => str(o?.duration?.timestamp || o?.duration?.seconds || o?.duration || o?.timestamp),
    views: o => str(o?.views ?? o?.view_count ?? o?.viewCount),
    published: o => str(o?.published ?? o?.ago ?? o?.uploaded ?? o?.upload_date ?? o?.published_at),
    thumb: o => {
        const t = o?.thumbnail || o?.image || o?.thumb || o?.thumbnailUrl;
        return isHttp(t) ? t : "";
    }
};

function pickUrl(j) {
    for (const o of [j?.data, j?.result, j]) {
        if (!o || typeof o !== "object") continue;
        for (const k of ["download_url", "downloadUrl", "download_link", "url", "link", "direct_url", "video"]) {
            if (isHttp(o[k]) && !/youtube\.com|youtu\.be/i.test(o[k])) return o[k];
        }
    }
    return "";
}

async function getPrefix(msg) {
    try {
        const clean = globalThis.SHAN_CLEAN_NUMBER;
        const botId = msg?.__shanSub ? clean(msg.__shanSub) : "main";
        const s = await globalThis.SHAN_GET_SETTINGS?.(botId);
        return s?.prefix || ".";
    } catch {
        return ".";
    }
}

function quotedTextOf(msg) {
    try {
        let m = msg?.message;
        for (let i = 0; i < 5 && m; i += 1) {
            const w = m.ephemeralMessage?.message || m.viewOnceMessage?.message || m.viewOnceMessageV2?.message || m.documentWithCaptionMessage?.message;
            if (!w) break;
            m = w;
        }
        const ctx = m?.extendedTextMessage?.contextInfo || m?.imageMessage?.contextInfo || m?.videoMessage?.contextInfo;
        let q = ctx?.quotedMessage || {};
        for (let i = 0; i < 5; i += 1) {
            const w = q.ephemeralMessage?.message || q.viewOnceMessage?.message || q.viewOnceMessageV2?.message || q.documentWithCaptionMessage?.message;
            if (!w) break;
            q = w;
        }
        return q.conversation || q.extendedTextMessage?.text || q.imageMessage?.caption || q.videoMessage?.caption || "";
    } catch {
        return "";
    }
}

/* =====================================================
   CHAMINDU API
===================================================== */

async function apiGet(endpoint, params = {}) {
    const headers = { Accept: "application/json", "User-Agent": UA };
    const query = { ...params };

    if (API_KEY) {
        headers["x-api-key"] = API_KEY;
        query.api_key = API_KEY;
    }

    try {
        const res = await axios.get(`${API_BASE}${endpoint}`, {
            params: query,
            headers,
            timeout: 90000,
            validateStatus: () => true
        });

        console.log(`▶️ [yt] ${endpoint} ${params.quality || ""} -> ${res.status}`, JSON.stringify(res.data)?.slice(0, 300));

        return { status: res.status, json: res.data };
    } catch (error) {
        console.error(`▶️ [yt] ${endpoint} error:`, error?.message || error);
        return { status: 0, json: null };
    }
}

const apiOk = j => j && j.success !== false && j.status !== false;

async function searchFirst(query) {
    const { json } = await apiGet("/search", { q: query });
    const list = Array.isArray(json?.data) ? json.data : Array.isArray(json?.result) ? json.result : [];

    return list.find(r => field.id(r) && field.title(r)) || null;
}

async function infoOf(id) {
    const { json } = await apiGet("/info", { url: `https://www.youtube.com/watch?v=${id}` });
    const d = json?.data && typeof json.data === "object" ? json.data : json;

    return apiOk(json) && d ? d : null;
}

// video endpoint eke nama danne naha -> godak nam try karanawa
async function chaminduVideoLink(id, h) {
    const url = `https://www.youtube.com/watch?v=${id}`;

    for (const ep of ["/mp4", "/video", "/ytmp4"]) {
        for (const quality of [`${h}p`, String(h)]) {
            const { status, json } = await apiGet(ep, { url, quality });

            if (status === 404) break; // me endpoint eka naha -> ilaga endpoint eka

            const link = apiOk(json) ? pickUrl(json) : "";

            if (link) return link;
        }
    }

    return "";
}

/* =====================================================
   SAVETUBE (fallback)
===================================================== */

const METADATA_KEY = Buffer.from("C5D58EF67A7584E4A29F6C35BBC4EB12", "hex");
const ST_HEADERS = { "Content-Type": "application/json", Origin: "https://yt.savetube.me", "User-Agent": UA };

async function savetubeVideoLink(id, h) {
    const cdnRes = await fetch("https://media.savetube.vip/api/random-cdn", {
        headers: ST_HEADERS, signal: AbortSignal.timeout(30000)
    }).then(r => r.json()).catch(() => null);

    if (!cdnRes?.cdn) throw new Error("SaveTube server unavailable");

    const cdn = cdnRes.cdn;

    const info = await fetch(`https://${cdn}/v2/info`, {
        method: "POST", headers: ST_HEADERS,
        body: JSON.stringify({ url: `https://www.youtube.com/watch?v=${id}` }),
        signal: AbortSignal.timeout(30000)
    }).then(r => r.json()).catch(() => null);

    if (!info?.data) throw new Error("SaveTube info failed");

    let meta;

    try {
        const enc = Buffer.from(info.data, "base64");
        const dec = createDecipheriv("aes-128-cbc", METADATA_KEY, enc.subarray(0, 16));
        meta = JSON.parse(Buffer.concat([dec.update(enc.subarray(16)), dec.final()]).toString("utf8"));
    } catch {
        throw new Error("SaveTube decode failed");
    }

    if (!meta?.key) throw new Error("SaveTube key missing");

    for (const quality of [String(h), `${h}p`]) {
        const dl = await fetch(`https://${cdn}/download`, {
            method: "POST", headers: ST_HEADERS,
            body: JSON.stringify({ id, downloadType: "video", quality, key: meta.key }),
            signal: AbortSignal.timeout(60000)
        }).then(r => r.json()).catch(() => null);

        if (dl?.data?.downloadUrl) return dl.data.downloadUrl;
    }

    throw new Error("SaveTube download link not found");
}

/* =====================================================
   DOWNLOAD (buffer)
===================================================== */

async function downloadBuffer(link) {
    let res;

    try {
        res = await axios.get(link, {
            responseType: "arraybuffer",
            timeout: 300000,
            maxContentLength: MAX_MB * 1024 * 1024,
            maxBodyLength: MAX_MB * 1024 * 1024,
            headers: { "User-Agent": UA, Origin: "https://yt.savetube.me" }
        });
    } catch (error) {
        if (/maxContentLength|exceeded/i.test(String(error?.message))) {
            const e = new Error("TOO_LARGE");
            e.code = "TOO_LARGE";
            throw e;
        }
        throw error;
    }

    const buf = Buffer.from(res.data);
    const type = String(res.headers?.["content-type"] || "");

    if (buf.length < 50 * 1024 || /text\/|json|html/i.test(type)) {
        throw new Error(`Bad video download (${buf.length} bytes, ${type || "unknown"})`);
    }

    return buf;
}

// Source 1 (Chamindu) -> Source 2 (SaveTube)
async function fetchVideoBuffer(id, h) {
    const errors = [];

    try {
        const link = await chaminduVideoLink(id, h);

        if (link) return await downloadBuffer(link);

        errors.push("api: no link");
    } catch (error) {
        if (error?.code === "TOO_LARGE") throw error;
        errors.push(`api: ${error?.message || error}`);
    }

    try {
        const link = await savetubeVideoLink(id, h);

        return await downloadBuffer(link);
    } catch (error) {
        if (error?.code === "TOO_LARGE") throw error;
        errors.push(`savetube: ${error?.message || error}`);
    }

    console.error("▶️ [yt] all sources failed ->", errors.join(" | "));

    throw new Error("ALL_FAILED");
}

/* =====================================================
   CARD + SELECTION
===================================================== */

const cache = new Map(); // id -> { videoId, title, time }

function sweep() {
    const now = Date.now();
    for (const [k, v] of cache) if (now - v.time > CACHE_TIME) cache.delete(k);
}

async function sendCard(sock, msg, base) {
    const jid = getJid(msg);
    const videoId = field.id(base);

    if (!videoId) {
        await sock.sendMessage(jid, { text: "❌ Invalid video link." }, { quoted: msg });
        return false;
    }

    const v = {
        title: field.title(base), author: field.author(base), duration: field.duration(base),
        views: field.views(base), published: field.published(base), thumb: field.thumb(base)
    };

    if (!v.title || !v.author || !v.views || !v.published || !v.duration) {
        const info = await infoOf(videoId);

        if (info) {
            v.title = v.title || field.title(info);
            v.author = v.author || field.author(info);
            v.duration = v.duration || field.duration(info);
            v.views = v.views || field.views(info);
            v.published = v.published || field.published(info);
            v.thumb = v.thumb || field.thumb(info);
        }
    }

    if (v.duration && toSeconds(v.duration) > MAX_MINUTES * 60) {
        await sock.sendMessage(
            jid, { text: `❌ Me video eka godak deegai (max ${MAX_MINUTES} minutes).` }, { quoted: msg }
        );
        return false;
    }

    v.title = v.title || "YouTube Video";
    v.thumb = v.thumb || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

    const id = newId();

    cache.set(id, { videoId, title: v.title, time: Date.now() });

    const caption =
        "╭━━━〔 💠 SHAN VIDEO 〕━━━╮\n" +
        "┃ 🎬 VIDEO INFORMATION\n" +
        "┣━━━━━━━━━━━━━━━━━━━\n" +
        `┃ 🎵 Title     : ${v.title}\n` +
        `┃ 👤 Channel   : ${v.author || "N/A"}\n` +
        `┃ 👀 Views     : ${fmtViews(v.views)}\n` +
        `┃ 📅 Released  : ${v.published || "N/A"}\n` +
        `┃ ⏱️ Duration  : ${fmtDur(v.duration)}\n` +
        "┣━━━━━━━━━━━━━━━━━━━\n" +
        `┃ 💎 ${MARKER}\n` +
        "┃\n" +
        OPTIONS.map(o => `┃ 〔 ${o.n} 〕 ${o.label}`).join("\n") + "\n" +
        "┃\n" +
        "┣━━━━━━━━━━━━━━━━━━━\n" +
        `┃ ↪ Reply with ${OPTIONS.map(o => o.n).join(", ")}\n` +
        `┃ 🆔 ${id}\n` +
        "╰━━━━━━━━━━━━━━━━━━━╯\n\n" +
        `⚡ ${FOOTER} 👨‍💻`;

    try {
        await sock.sendMessage(jid, { image: { url: v.thumb }, caption }, { quoted: msg });
    } catch {
        await sock.sendMessage(jid, { text: caption }, { quoted: msg });
    }

    return true;
}

async function sendChosen(sock, msg, entry, opt) {
    const jid = getJid(msg);

    let buffer;

    try {
        buffer = await fetchVideoBuffer(entry.videoId, opt.h);
    } catch (error) {
        const text =
            error?.code === "TOO_LARGE"
                ? `❌ Video eka ${MAX_MB}MB wada loku. Podi quality ekak (480p / 360p) select karanna.`
                : "❌ Video eka download karanna bari una. Passe aye try karanna, nathnam wena quality ekak select karanna.";

        await sock.sendMessage(jid, { text }, { quoted: msg });
        return false;
    }

    const safe = entry.title.replace(/[\\/:*?"<>|\n\r]/g, "").slice(0, 80) || "video";
    const caption = `🎬 ${entry.title}\n📺 ${opt.h}p\n\n⚡ ${FOOTER}`;

    try {
        if (opt.doc) {
            await sock.sendMessage(
                jid,
                { document: buffer, mimetype: "video/mp4", fileName: `${safe}.mp4`, caption },
                { quoted: msg }
            );
        } else {
            await sock.sendMessage(jid, { video: buffer, mimetype: "video/mp4", caption }, { quoted: msg });
        }
    } catch (error) {
        console.error("▶️ [yt] send error:", error?.message || error);

        await sock.sendMessage(jid, { text: "❌ Video eka yawanna bari una." }, { quoted: msg });
        return false;
    }

    return true;
}

/* =====================================================
   PLUGIN
===================================================== */

export default {
    name: "SHAN MINI BOT YOUTUBE",
    command: "yt",
    alias: ["ytv", "ytvideo", "ytmp4", "video", "vid"],
    category: "DOWNLOAD",
    description: "Download YouTube videos (720p / 480p / 360p / document)",
    usage: ".yt <name | link>",
    replyHandler: true,

    async execute(sock, msg, args) {
        const jid = getJid(msg);
        const query = args.join(" ").trim();

        sweep();

        const react = emoji => sock.sendMessage(jid, { react: { text: emoji, key: msg.key } }).catch(() => {});

        if (!query) {
            const p = await getPrefix(msg);

            return sock.sendMessage(
                jid,
                {
                    text:
                        "🎬 *YouTube Video Downloader*\n\n" +
                        `📌 Use: *${p}yt <name | link>*\n` +
                        `📌 Example: ${p}yt https://youtu.be/dQw4w9WgXcQ\n\n` +
                        FOOTER
                },
                { quoted: msg }
            );
        }

        try {
            await react("🔎");

            let base;
            const vid = ytIdFromText(query);

            if (vid) {
                base = { id: vid };
            } else {
                base = await searchFirst(query);

                if (!base) {
                    await react("❌");
                    return sock.sendMessage(jid, { text: `❌ "${query}" walata results hambune naha.` }, { quoted: msg });
                }
            }

            const ok = await sendCard(sock, msg, base);

            await react(ok ? "✅" : "❌");
        } catch (error) {
            console.error("▶️ [yt] error:", error?.message || error);
            await react("❌");
            await sock.sendMessage(jid, { text: "❌ Video eka ganna bari una. Passe aye try karanna." }, { quoted: msg });
        }
    },

    // true = handled, false = ignore
    async handleReply(sock, msg, text) {
        try {
            const quoted = quotedTextOf(msg);

            if (!quoted.includes(MARKER)) return false;

            const jid = getJid(msg);
            const id = (quoted.match(/🆔\s*([a-z0-9]{4,8})/i) || [])[1];
            const opt = OPTIONS.find(o => o.n === Number(String(text || "").trim()));

            if (!opt) {
                await sock.sendMessage(
                    jid,
                    { text: `🔢 ${OPTIONS.map(o => o.n).join(", ")} walin ekak reply karanna.` },
                    { quoted: msg }
                );
                return true;
            }

            sweep();

            const entry = id ? cache.get(id) : null;

            if (!entry) {
                const p = await getPrefix(msg);

                await sock.sendMessage(
                    jid, { text: `⌛ Me card eka expire wela. Aye *${p}yt <name>* karanna.` }, { quoted: msg }
                );
                return true;
            }

            const react = emoji => sock.sendMessage(jid, { react: { text: emoji, key: msg.key } }).catch(() => {});

            await react("⏳");

            const ok = await sendChosen(sock, msg, entry, opt);

            await react(ok ? "✅" : "❌");

            return true;
        } catch (error) {
            console.error("▶️ [yt] reply error:", error?.message || error);
            return false;
        }
    }
};
