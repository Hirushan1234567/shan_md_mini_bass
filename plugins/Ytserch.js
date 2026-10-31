// plugins/ytsearch.js
// SHAN MINI BOT V1 — YouTube search (number reply)
//
//   .ytsearch <words>   →  top 8 results list
//   reply with 1-8      →  runs ".song <that video link>"  (song.js එකේ card + 1/2/3 flow එකම)
//
// Needs: yt-search (song.js / play.js වල දැනටමත් තියෙනවා)
// Premium gating: song.js එකේ සාමාන්‍ය විදිහටම වැඩ කරනවා (.premiumco song)

import yts from "yt-search";
import { t, langOf } from "../lang.js";

const COMMANDS = ["ytsearch", "yts", "ytsr"];
const CACHE_TTL = 10 * 60 * 1000;
const RESULTS = 8;

const store = new Map(); // bot message id -> { chat, time, videos:[{id,title}] }

function cleanCache() {
  const now = Date.now();

  for (const [id, entry] of store) {
    if (now - entry.time > CACHE_TTL) store.delete(id);
  }

  while (store.size > 200) store.delete(store.keys().next().value);
}

async function getPrefix() {
  try {
    const s = await globalThis.SHAN_GET_SETTINGS?.();
    if (s?.prefix) return s.prefix;
  } catch {}
  return process.env.PREFIX || ".";
}

const say = (sock, msg, text) =>
  sock.sendMessage(msg.key.remoteJid, { text }, { quoted: msg });

async function react(sock, msg, emoji) {
  try {
    await sock.sendMessage(msg.key.remoteJid, { react: { text: emoji, key: msg.key } });
  } catch {}
}

function stanzaIdOf(msg) {
  const m = msg?.message?.ephemeralMessage?.message || msg?.message;

  return (
    m?.extendedTextMessage?.contextInfo?.stanzaId ||
    m?.imageMessage?.contextInfo?.stanzaId ||
    ""
  );
}

const short = (s, n = 60) => (String(s).length > n ? String(s).slice(0, n - 1) + "…" : String(s));

export default {
  command: "ytsearch",
  commands: COMMANDS,

  // index.js එකට: bot message වලට reply කරද්දී handleReply() call කරන්න
  replyHandler: true,

  async execute(sock, msg, args = []) {
    const query = args.join(" ").trim();

    if (!query) {
      const prefix = await getPrefix();

      return say(sock, msg, t("yt.usage", await langOf(msg), { p: prefix }));
    }

    await react(sock, msg, "🔎");

    const lang = await langOf(msg);

    try {
      const result = await yts(query);
      const videos = (result?.videos || []).filter(v => v?.videoId).slice(0, RESULTS);

      if (!videos.length) {
        await react(sock, msg, "❌");
        return say(sock, msg, t("yt.none", lang));
      }

      const lines = [
        `╭━━━〔 🔎 ${t("yt.title", lang)} 〕━━━╮`,
        `┃ 🔍 ${short(query, 40)}`,
        `┣━━━━━━━━━━━━━━━━━━━`
      ];

      videos.forEach((v, i) => {
        lines.push(
          `┃ 〔 ${i + 1} 〕 ${short(v.title)}`,
          `┃      👤 ${short(v.author?.name || "Unknown", 30)}  ⏱️ ${v.timestamp || "N/A"}`
        );
      });

      lines.push(
        `┣━━━━━━━━━━━━━━━━━━━`,
        `┃ ${t("yt.reply", lang, { n: videos.length })}`,
        `╰━━━━━━━━━━━━━━━━━━━╯`,
        ``,
        `⚡ 𝐏𝐎𝐖𝐄𝐑𝐄𝐃 𝐁𝐘 SHAN MINI BOT 💙`
      );

      const sent = await say(sock, msg, lines.join("\n"));

      cleanCache();

      if (sent?.key?.id) {
        store.set(sent.key.id, {
          chat: msg.key.remoteJid,
          time: Date.now(),
          videos: videos.map(v => ({ id: v.videoId, title: v.title }))
        });
      }

      await react(sock, msg, "✅");
    } catch (error) {
      console.error("[YTSEARCH] error:", error?.message || error);
      await react(sock, msg, "❌");

      return say(sock, msg, `❌ ${error?.message || t("yt.failed", lang)}`);
    }
  },

  async handleReply(sock, msg, text) {
    const n = parseInt(String(text || "").trim(), 10);

    if (!/^\d{1,2}$/.test(String(text || "").trim())) return false;

    const jid = msg.key.remoteJid;
    const quotedId = stanzaIdOf(msg);
    const entry = store.get(quotedId);

    // අපේ search list එකකට reply එකක් නෙවෙයි → වෙන plugin එකට දෙන්න
    if (!entry || entry.chat !== jid) return false;

    const lang = await langOf(msg);

    if (Date.now() - entry.time > CACHE_TTL) {
      store.delete(quotedId);
      await say(sock, msg, t("common.expired", lang));
      return true;
    }

    const pick = entry.videos[n - 1];

    if (!pick) {
      await say(sock, msg, t("yt.bad", lang, { n: entry.videos.length }));
      return true;
    }

    // index.js එකේ messages.upsert එකට ".song <link>" message එකක් යවනවා.
    // එතකොට song.js එකේ සාමාන්‍ය flow එකම (premium / block / settings checks එක්කම) run වෙනවා.
    const prefix = await getPrefix();

    const fake = {
      ...msg,
      message: { conversation: `${prefix}song https://youtu.be/${pick.id}` }
    };

    sock.ev.emit("messages.upsert", { messages: [fake], type: "notify" });

    return true;
  }
};
