import mongoose from "mongoose";
import fs from "fs";
import { downloadMediaMessage } from "@whiskeysockets/baileys";

const OWNER_NUMBER = (process.env.OWNER_NUMBER || "94752661225").replace(/\D/g, "");
const OWNER_JID = `${OWNER_NUMBER}@s.whatsapp.net`;

/* =========================
   SCHEMA
========================= */

const definition = {
  /* General */
  publicMode: { type: Boolean, default: true },
  ownerOnly: { type: Boolean, default: false },
  prefix: { type: String, default: "." },
  chatMode: { type: String, enum: ["all", "groups", "private"], default: "all" },
  bannedUsers: { type: [String], default: [] },

  /* Auto */
  autoSeen: { type: Boolean, default: false },
  autoReact: { type: Boolean, default: false },
  autoTyping: { type: Boolean, default: false },
  typingMode: { type: String, enum: ["composing", "recording"], default: "composing" },
  autoReply: { type: Boolean, default: false },
  autoReplyCooldown: { type: Number, default: 60 },
  autoReplyText: {
    type: String,
    default: "👋 Hi! I'm busy right now. I'll reply to you soon.\n\n🤖 _SHAN MINI BOT_"
  },
  alwaysOnline: { type: Boolean, default: false },

  /* Status */
  statusAutoSeen: { type: Boolean, default: false },
  statusAutoReact: { type: Boolean, default: false },
  statusReactMode: { type: String, enum: ["fixed", "random"], default: "fixed" },
  statusReactEmoji: { type: String, default: "❤️" },
  statusReactEmojis: {
    type: [String],
    default: ["❤️", "🔥", "😍", "🥰", "😂", "💯", "👏", "👍", "✨", "😮"]
  },

  /* Group */
  welcome: { type: Boolean, default: false },
  goodbye: { type: Boolean, default: false },
  welcomePic: { type: Boolean, default: true },
  welcomeText: {
    type: String,
    default:
      "👋 *Welcome* {user}\n\n🎉 Welcome to *{group}*!\n👥 Members: {count}\nPlease read the rules and enjoy your stay. 💖"
  },
  goodbyeText: {
    type: String,
    default: "👋 *Goodbye* {user}\n\n😢 Left *{group}*. See you again!"
  },
  antiLink: { type: Boolean, default: false },
  allowedDomains: { type: [String], default: [] },
  antiBadword: { type: Boolean, default: false },
  badWords: { type: [String], default: [] },
  antiSpam: { type: Boolean, default: false },
  spamLimit: { type: Number, default: 6 },
  punishAction: { type: String, enum: ["delete", "warn", "kick"], default: "delete" },
  warnLimit: { type: Number, default: 3 },

  /* Media */
  autoSticker: { type: Boolean, default: false },
  autoDownload: { type: Boolean, default: false },
  autoCrop: { type: Boolean, default: false },
  stickerPack: { type: String, default: "SHAN MINI BOT" },
  stickerAuthor: { type: String, default: "Kingdom of Devil" },

  /* Protection */
  antiDelete: { type: Boolean, default: false },
  antiDeleteTarget: { type: String, enum: ["owner", "chat"], default: "owner" },
  antiViewOnce: { type: Boolean, default: false },
  vv: { type: Boolean, default: false },
  antiCall: { type: Boolean, default: false },
  antiCallBlock: { type: Boolean, default: false },
  callMessage: {
    type: String,
    default: "📵 Calls are not allowed. Please send a message instead.\n\n🤖 _SHAN MINI BOT_"
  },

  /* Control */
  maintenance: { type: Boolean, default: false },
  maintenanceText: {
    type: String,
    default: "🚧 The bot is under maintenance right now. Please try again later.\n\n🤖 _SHAN MINI BOT_"
  },
  cmdCooldown: { type: Number, default: 0 },
  antiFake: { type: Boolean, default: false },
  allowedCountryCodes: { type: [String], default: ["94"] },

  /* System */
  autoReconnect: { type: Boolean, default: true },
  debugMode: { type: Boolean, default: false },

  /* AI & Sri Lanka tools */
  aiEnabled: { type: Boolean, default: true },
  aiLanguage: { type: String, enum: ["sinhala", "english", "auto"], default: "sinhala" },
  ttsLang: { type: String, enum: ["si", "en", "ta"], default: "si" },
  dailyLimit: { type: Number, default: 20 },
  disconnectAlert: { type: Boolean, default: true }
};

const settingsSchema = new mongoose.Schema(definition, {
  timestamps: true,
  collection: "botsettings"
});

// Re-compile so newly added fields are never stripped by an old cached model
if (mongoose.models.ShanSettings) mongoose.deleteModel("ShanSettings");
const BotSettings = mongoose.model("ShanSettings", settingsSchema);

/* =========================
   HELPERS
========================= */

let cache = null;
let cacheAt = 0;

async function getSettings(fresh = false) {
  if (!fresh && cache && Date.now() - cacheAt < 3000) return cache;
  let s = await BotSettings.findOne();
  if (!s) s = await BotSettings.create({});
  cache = s;
  cacheAt = Date.now();
  return s;
}

async function saveSettings(s) {
  await s.save();
  cache = s;
  cacheAt = Date.now();
}

const state = v => (v ? "ON" : "OFF");
const sleep = ms => new Promise(r => setTimeout(r, ms));

function clean(v = "") {
  return String(v).split("@")[0].split(":")[0].replace(/\D/g, "");
}

function senderIds(msg) {
  const k = msg?.key || {};
  return [k.senderPn, k.participantPn, k.participantAlt, k.participant, k.remoteJidAlt, k.remoteJid]
    .filter(Boolean)
    .map(clean);
}

function isOwner(msg) {
  if (msg?.key?.fromMe === true) return true;
  return senderIds(msg).some(v => v === OWNER_NUMBER);
}

function getRandomEmoji(list, fallback = "❤️") {
  const arr = Array.isArray(list) && list.length ? list : [fallback];
  return arr[Math.floor(Math.random() * arr.length)];
}

function validPrefix(p) {
  return Boolean(p) && p.length <= 3 && !/\s/.test(p);
}

function parseBool(v) {
  const t = String(v).trim().toLowerCase();
  if (["on", "true", "1", "yes", "enable", "enabled"].includes(t)) return true;
  if (["off", "false", "0", "no", "disable", "disabled"].includes(t)) return false;
  return null;
}

function unwrap(message) {
  let m = message;
  for (let i = 0; i < 3; i++) {
    m =
      m?.ephemeralMessage?.message ||
      m?.viewOnceMessage?.message ||
      m?.viewOnceMessageV2?.message ||
      m?.viewOnceMessageV2Extension?.message ||
      m;
  }
  return m;
}

function getText(msg) {
  const m = unwrap(msg?.message);
  return (
    m?.conversation ||
    m?.extendedTextMessage?.text ||
    m?.imageMessage?.caption ||
    m?.videoMessage?.caption ||
    ""
  );
}

function fill(template, vars) {
  return String(template).replace(/\{(\w+)\}/g, (_, k) => (k in vars ? vars[k] : `{${k}}`));
}

/* =========================
   GROUP HELPERS
========================= */

const metaCache = new Map();

async function getGroupMeta(sock, jid) {
  const hit = metaCache.get(jid);
  if (hit && Date.now() - hit.at < 60000) return hit.meta;
  const meta = await sock.groupMetadata(jid);
  metaCache.set(jid, { meta, at: Date.now() });
  return meta;
}

function idsOf(p) {
  return [p?.id, p?.lid, p?.jid, p?.phoneNumber].filter(Boolean).map(clean);
}

function isAdminIn(meta, targets) {
  const want = new Set(targets.filter(Boolean).map(clean));
  return (meta?.participants || []).some(
    p => (p.admin === "admin" || p.admin === "superadmin") && idsOf(p).some(i => want.has(i))
  );
}

function botIds(sock) {
  return [sock?.user?.id, sock?.user?.lid, sock?.user?.jid];
}

/* =========================
   SETTINGS REGISTRY
   (menu + reply handler are generated from this)
   types: set | bool | enum | number | text | list
   Category number = item id prefix (1.x = General, 2.x = Auto ...)
========================= */

const MENU = [
  {
    title: "🌐 GENERAL",
    items: [
      { id: "1.1", label: "Public", type: "set", key: "publicMode", value: true },
      { id: "1.2", label: "Private", type: "set", key: "publicMode", value: false },
      { id: "1.3", label: "Owner Only", type: "bool", key: "ownerOnly" },
      { id: "1.4", label: "Prefix", type: "text", key: "prefix", max: 3, validate: validPrefix, invalid: "Maximum 3 characters; spaces are not allowed." },
      { id: "1.5", label: "Chat Mode", type: "enum", key: "chatMode", options: ["all", "groups", "private"] },
      { id: "1.6", label: "Banned Users", type: "list", key: "bannedUsers", norm: clean, hint: "94771234567" }
    ]
  },
  {
    title: "🤖 AUTO",
    items: [
      { id: "2.1", label: "Auto Seen", type: "bool", key: "autoSeen" },
      { id: "2.2", label: "Auto React", type: "bool", key: "autoReact" },
      { id: "2.3", label: "Auto Typing", type: "bool", key: "autoTyping" },
      { id: "2.4", label: "Auto Reply", type: "bool", key: "autoReply" },
      { id: "2.5", label: "Typing Mode", type: "enum", key: "typingMode", options: ["composing", "recording"] },
      { id: "2.6", label: "Reply Delay", type: "number", key: "autoReplyCooldown", min: 1, max: 1440, unit: "m", note: "minutes between auto replies per person" },
      { id: "2.7", label: "Reply Text", type: "text", key: "autoReplyText", max: 400 }
    ]
  },
  {
    title: "👥 GROUP",
    items: [
      { id: "3.1", label: "Welcome", type: "bool", key: "welcome" },
      { id: "3.2", label: "Goodbye", type: "bool", key: "goodbye" },
      { id: "3.9", label: "Welcome Pic", type: "bool", key: "welcomePic" },
      { id: "3.10", label: "Welcome Text", type: "text", key: "welcomeText", max: 500, note: "use {user} {group} {count}" },
      { id: "3.11", label: "Goodbye Text", type: "text", key: "goodbyeText", max: 500, note: "use {user} {group} {count}" },
      { id: "3.3", label: "Anti Link", type: "bool", key: "antiLink" },
      { id: "3.12", label: "Allowed Links", type: "list", key: "allowedDomains", norm: d => d.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0], hint: "youtube.com" },
      { id: "3.5", label: "Anti Badword", type: "bool", key: "antiBadword" },
      { id: "3.13", label: "Bad Words", type: "list", key: "badWords", norm: w => w.toLowerCase(), hint: "word" },
      { id: "3.4", label: "Anti Spam", type: "bool", key: "antiSpam" },
      { id: "3.8", label: "Spam Limit", type: "number", key: "spamLimit", min: 3, max: 20, unit: " msgs", note: "messages within 8 seconds" },
      { id: "3.6", label: "Punishment", type: "enum", key: "punishAction", options: ["delete", "warn", "kick"] },
      { id: "3.7", label: "Warn Limit", type: "number", key: "warnLimit", min: 1, max: 10, note: "warnings before kick" }
    ]
  },
  {
    title: "🎨 MEDIA",
    items: [
      { id: "4.1", label: "Sticker", type: "bool", key: "autoSticker" },
      { id: "4.2", label: "Download", type: "bool", key: "autoDownload" },
      { id: "4.3", label: "Auto Crop", type: "bool", key: "autoCrop" },
      { id: "4.4", label: "Sticker Pack", type: "text", key: "stickerPack", max: 30 },
      { id: "4.5", label: "Sticker Author", type: "text", key: "stickerAuthor", max: 30 }
    ]
  },
  {
    title: "⚡ SYSTEM",
    items: [
      { id: "5.1", label: "Reconnect", type: "bool", key: "autoReconnect" },
      { id: "5.2", label: "Debug", type: "bool", key: "debugMode" },
      { id: "5.3", label: "Always Online", type: "bool", key: "alwaysOnline" }
    ]
  },
  {
    title: "📱 STATUS",
    items: [
      { id: "6.1", label: "Status Seen", type: "bool", key: "statusAutoSeen" },
      { id: "6.2", label: "Status React", type: "bool", key: "statusAutoReact" },
      { id: "6.3", label: "React Mode", type: "enum", key: "statusReactMode", options: ["fixed", "random"] },
      { id: "6.4", label: "React Emoji", type: "text", key: "statusReactEmoji", max: 8 },
      { id: "6.5", label: "Random Emojis", type: "list", key: "statusReactEmojis", norm: x => x, hint: "🔥 😍" }
    ]
  },
  {
    title: "🛡️ PROTECTION",
    items: [
      { id: "7.1", label: "Anti Delete", type: "bool", key: "antiDelete" },
      { id: "7.2", label: "Delete Target", type: "enum", key: "antiDeleteTarget", options: ["owner", "chat"] },
      { id: "7.3", label: "Anti ViewOnce", type: "bool", key: "antiViewOnce" },
      { id: "7.7", label: "VV Save", type: "bool", key: "vv", note: "reply to a view-once → saved to bot inbox" },
      { id: "7.4", label: "Anti Call", type: "bool", key: "antiCall" },
      { id: "7.5", label: "Block Callers", type: "bool", key: "antiCallBlock" },
      { id: "7.6", label: "Call Message", type: "text", key: "callMessage", max: 300 }
    ]
  },
  {
    title: "🚦 CONTROL",
    items: [
      { id: "8.1", label: "Maintenance", type: "bool", key: "maintenance" },
      { id: "8.2", label: "Maint. Text", type: "text", key: "maintenanceText", max: 300 },
      { id: "8.3", label: "Cmd Cooldown", type: "number", key: "cmdCooldown", min: 0, max: 60, unit: "s", note: "seconds between commands per user (0 = off)" },
      { id: "8.4", label: "Anti Fake", type: "bool", key: "antiFake" },
      { id: "8.5", label: "Allowed Codes", type: "list", key: "allowedCountryCodes", norm: c => c.replace(/\D/g, ""), hint: "94" }
    ]
  },
  {
    title: "🇱🇰 AI & SRI LANKA",
    items: [
      { id: "9.1", label: "AI Chat", type: "bool", key: "aiEnabled", note: "enable / disable the ai command" },
      { id: "9.2", label: "AI Language", type: "enum", key: "aiLanguage", options: ["sinhala", "english", "auto"] },
      { id: "9.3", label: "TTS Language", type: "enum", key: "ttsLang", options: ["si", "en", "ta"] },
      { id: "9.4", label: "Daily Limit", type: "number", key: "dailyLimit", min: 0, max: 500, unit: " cmds", note: "free users per day for ai / tts / downloads (0 = unlimited)" },
      { id: "9.5", label: "Disconnect Alert", type: "bool", key: "disconnectAlert", note: "notify a user when their bot disconnects" }
    ]
  }
];

const ITEMS = new Map(MENU.flatMap(c => c.items).map(i => [i.id, i]));

// Menu එකේ පේන සරල අංක: 1, 2, 3 ... (හැම setting එකකටම එක අංකයක්)
const BY_NUM = new Map();
MENU.flatMap(c => c.items).forEach((item, idx) => {
  item.n = idx + 1;
  BY_NUM.set(item.n, item);
});

// category number ("1".."8") -> category
const CAT_BY_NUM = new Map(MENU.map(c => [c.items[0].id.split(".")[0], c]));

const catNumOf = id => String(id).split(".")[0];

function fmtValue(item, s) {
  const v = s[item.key];
  switch (item.type) {
    case "set": return state(v === item.value);
    case "bool": return state(v);
    case "enum": return String(v).toUpperCase();
    case "number": return `${v}${item.unit || ""}`;
    case "text": {
      const t = String(v ?? "").replace(/\s+/g, " ");
      return t.length > 14 ? `${t.slice(0, 13)}…` : t || "-";
    }
    case "list": return `${(v || []).length} items`;
    default: return String(v);
  }
}

/* =========================
   MENU STYLE  (2-level menu)
   Level 1 : main menu  -> categories (1..8) + ON/OFF counts
   Level 2 : category   -> that category's settings only (short, easy to find)
   Extra   : "find <word>" search, "ON" list of enabled features
========================= */

const EMOJI = {
  "1.1": "🌍", "1.2": "🔒", "1.3": "👑", "1.4": "📌", "1.5": "💬", "1.6": "🚫",
  "2.1": "👁️", "2.2": "🤖", "2.3": "⌨️", "2.4": "🧠", "2.5": "✍️", "2.6": "⏱️", "2.7": "📝",
  "6.1": "👁️", "6.2": "❤️", "6.3": "🎲", "6.4": "✨", "6.5": "🎭",
  "3.1": "👋", "3.2": "😢", "3.9": "🖼️", "3.10": "📜", "3.11": "📃",
  "3.3": "🔗", "3.12": "✅", "3.5": "🤬", "3.13": "📕", "3.4": "🚷", "3.8": "📊", "3.6": "⚖️", "3.7": "⚠️",
  "4.1": "🎭", "4.2": "⬇️", "4.3": "✂️", "4.4": "📦", "4.5": "✍️",
  "7.1": "🗑️", "7.2": "🎯", "7.3": "👁️", "7.4": "📞", "7.5": "⛔", "7.6": "💬", "7.7": "🕵️",
  "5.1": "🔁", "5.2": "🐞", "5.3": "🟢",
  "8.1": "🚧", "8.2": "💬", "8.3": "⏱️", "8.4": "🛂", "8.5": "🏳️",
  "9.1": "🤖", "9.2": "🗣️", "9.3": "🔊", "9.4": "📊", "9.5": "📡"
};

const MARKER = "SHAN_SETTINGS_MENU_V1";

const onOff = v => (v ? "🟢 ON" : "🔴 OFF");
const mark = on => (on ? "✅" : "▫️");

function styledValue(item, s) {
  const v = s[item.key];

  switch (item.type) {
    case "bool":
      return onOff(v);
    case "enum":
      return `🔀 ${String(v).toUpperCase()}`;
    case "number":
      return `🔢 ${v}${item.unit || ""}`;
    case "list":
      return `📋 ${(v || []).length} items`;
    case "text": {
      if (item.key === "prefix") return `[ ${v} ]`;
      const t = String(v ?? "").replace(/\s+/g, " ");
      return `✏️ ${t.length > 16 ? `${t.slice(0, 15)}…` : t || "-"}`;
    }
    default:
      return fmtValue(item, s);
  }
}

const itemRow = (i, s) =>
  `│ *${i.id}* ${EMOJI[i.id] || "▫️"} ${i.label}  ➜  ${styledValue(i, s)}\n`;

// category එකක ON වෙලා තියෙන bool settings ගාන
function catCounts(cat, s) {
  const bools = cat.items.filter(i => i.type === "bool");
  const on = bools.filter(i => s[i.key] === true).length;
  return { on, total: bools.length };
}

/* ---------- Single flat menu ---------- */

const flatRow = (i, s) => {
  if (i.type === "set") {
    return `│ *${i.n}* ${EMOJI[i.id] || "▫️"} ${i.label}  ➜  ${s[i.key] === i.value ? "✅ SELECTED" : "▫️"}\n`;
  }

  return `│ *${i.n}* ${EMOJI[i.id] || "▫️"} ${i.label}  ➜  ${styledValue(i, s)}\n`;
};

function createMenu(s, ctx = {}, note = "") {
  const userName = ctx.userName || "Owner";
  const botNumber = ctx.botNumber || "";

  const date = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Colombo",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric"
  }).format(new Date());

  const all = MENU.flatMap(c => c.items);
  const active = all.filter(i => i.type === "bool" && s[i.key] === true).length;

  const ex = {};
  for (const i of all) if (!ex[i.type]) ex[i.type] = i;

  let m = "";

  if (note) m += `${note}\n\n`;

  m += `╭━━━━━━━━━━━━━━━━━━━━━╮\n`;
  m += `┃  👑 *S H A N  M I N I  B O T* 👑\n`;
  m += `┃  ⚙️ *SETTINGS PANEL*\n`;
  m += `╰━━━━━━━━━━━━━━━━━━━━━╯\n\n`;
  m += `👤 *User* ➜ ${userName}\n`;
  m += `📱 *Bot* ➜ ${botNumber}\n`;
  m += `📅 *Date* ➜ ${date}\n`;
  m += `🔰 *Active* ➜ ${active} features ON\n`;
  m += `📡 *Presence* ➜ ${s.alwaysOnline ? "🟢 Always Online" : "⚫ Hidden (Offline)"}\n`;

  for (const cat of MENU) {
    m += `\n╭─❖ *${cat.title}* ❖\n`;

    if (cat.items[0].id.startsWith("1.")) {
      m += `│ 🛡️ *Work Type*\n`;
    }

    for (const i of cat.items) m += flatRow(i, s);

    m += `╰──────────────────❖\n`;
  }

  m += `\n╭─❖ *🎯 HOW TO CHANGE* ❖\n`;
  m += `│ 💡 _Reply to this message with the number_\n│\n`;
  if (ex.bool) m += `│ 🔘 *ON / OFF*  ➜  *${ex.bool.n}*\n`;
  if (ex.enum) m += `│ 🔀 *Options*   ➜  *${ex.enum.n}*  (next option)\n`;
  if (ex.number) m += `│ 🔢 *Number*    ➜  *${ex.number.n} 30*\n`;
  if (ex.text) m += `│ ✏️ *Text*      ➜  *${ex.text.n} My text*\n`;
  if (ex.list) m += `│ 📋 *List*      ➜  *${ex.list.n} +item* / *-item* / *clear*\n`;
  m += `│ ♻️ *Reset all* ➜  *RESET*\n`;
  m += `│\n`;
  m += `│ ✅ After each change this menu is sent\n`;
  m += `│    again with the new values.\n`;
  m += `╰──────────────────❖\n`;
  m += `\n━━━━━━━━━━━━━━━━━━━━━\n`;
  m += `💝 *SHAN MINI BOT V1*\n`;
  m += `━━━━━━━━━━━━━━━━━━━━━\n\n`;
  m += MARKER;

  return m;
}

async function sendMenu(sock, jid, msg, withLogo = true, note = "") {
  const s = await getSettings(true);

  const menu = createMenu(
    s,
    {
      userName: msg?.pushName || "Owner",
      botNumber: clean(sock?.user?.id || "")
    },
    note
  );

  if (withLogo && fs.existsSync("./logo.jpg")) {
    await sock.sendMessage(
      jid,
      { image: fs.readFileSync("./logo.jpg"), caption: "⚙️ *SHAN MINI BOT — SETTINGS*" },
      { quoted: msg }
    );
  }

  return sock.sendMessage(jid, { text: menu }, withLogo ? { quoted: msg } : undefined);
}

/* =========================
   APPLY A SETTING
========================= */

async function applyItem(item, arg, s, sock) {
  const v = arg?.trim();
  const before = styledValue(item, s);

  switch (item.type) {
    case "set":
      s[item.key] = item.value;
      break;

    case "bool": {
      if (v) {
        const b = parseBool(v);
        if (b === null) return "❌ Use *on* or *off*.";
        s[item.key] = b;
      } else {
        s[item.key] = !s[item.key];
      }
      if (item.key === "alwaysOnline") await applyPresenceAll(s.alwaysOnline);
      break;
    }

    case "enum": {
      const opts = item.options;
      if (v) {
        const pick = opts.find(o => o === v.toLowerCase());
        if (!pick) return `❌ Choose one of: ${opts.join(" / ")}`;
        s[item.key] = pick;
      } else {
        s[item.key] = opts[(opts.indexOf(s[item.key]) + 1) % opts.length];
      }
      break;
    }

    case "number": {
      if (!v) {
        return `🔢 *${item.label}* is now *${s[item.key]}${item.unit || ""}*\n\nSend a new value:\n${item.n} <${item.min}-${item.max}>${item.note ? `\n(${item.note})` : ""}`;
      }
      const n = parseInt(v, 10);
      if (Number.isNaN(n) || n < item.min || n > item.max) {
        return `❌ Enter a number between ${item.min} and ${item.max}.`;
      }
      s[item.key] = n;
      break;
    }

    case "text": {
      if (!v) {
        return `✏️ *${item.label}*\n\nCurrent:\n${s[item.key]}\n\nSend a new value:\n${item.n} <text>${item.note ? `\n(${item.note})` : ""}\nReset: ${item.n} default`;
      }
      if (v.toLowerCase() === "default") {
        s[item.key] = definition[item.key].default;
      } else {
        if (v.length > (item.max || 200)) return `❌ Too long. Maximum ${item.max || 200} characters.`;
        if (item.validate && !item.validate(v)) return `❌ Invalid value. ${item.invalid || ""}`.trim();
        s[item.key] = v;
      }
      break;
    }

    case "list": {
      const list = [...(s[item.key] || [])];
      if (!v) {
        return `📋 *${item.label}* (${list.length})\n\n${list.length ? list.join("\n") : "— empty —"}\n\nAdd: ${item.n} +${item.hint || "item"}\nRemove: ${item.n} -${item.hint || "item"}\nClear: ${item.n} clear`;
      }
      if (v.toLowerCase() === "clear") {
        s[item.key] = [];
        break;
      }
      const remove = v.startsWith("-");
      const items = v
        .replace(/^[+-]/, "")
        .split(/[\s,]+/)
        .filter(Boolean)
        .map(item.norm || (x => x.toLowerCase()))
        .filter(Boolean);

      if (!items.length) return "❌ Nothing to add or remove.";

      s[item.key] = remove
        ? list.filter(x => !items.includes(x))
        : [...new Set([...list, ...items])];
      break;
    }

    default:
      return null;
  }

  await saveSettings(s);
  const after = styledValue(item, s);
  let out = `✅ *${EMOJI[item.id] || "⚙️"} ${item.label}* updated\n${before}  ➜  ${after}`;

  if (item.key === "alwaysOnline") {
    out += s.alwaysOnline
      ? "\n📡 You will stay *Online* 24/7."
      : "\n📡 You will appear *Offline* (hidden) even while the bot works.";
  }

  if (item.key === "vv") {
    out += s.vv
      ? "\n🕵️ Reply to any view-once photo/video/audio → it is saved to the bot's inbox."
      : "\n🕵️ VV Save is OFF.";
  }

  return out;
}

async function resetAll(s) {
  const fresh = new BotSettings({});
  for (const key of Object.keys(definition)) s[key] = fresh[key];
  await saveSettings(s);
}

/* =========================
   ALWAYS ONLINE
========================= */

let currentSock = null;
let timer = null;

// Main bot + sub-bots (pair site එකෙන් එන ඒවා) හැම socket එකක්ම මෙතන තියාගන්නවා
const socks = new Set();

function socketAlive(sock) {
  try {
    if (sock?.ws?.isClosed || sock?.ws?.isClosing) return false;
    return Boolean(sock?.user);
  } catch {
    return false;
  }
}

async function applyPresence(sock, enabled) {
  try {
    await sock.sendPresenceUpdate(enabled ? "available" : "unavailable");
  } catch {}
}

async function applyPresenceAll(enabled) {
  for (const sock of [...socks]) {
    if (!socketAlive(sock)) {
      if (sock?.ws?.isClosed) socks.delete(sock);
      continue;
    }
    await applyPresence(sock, enabled);
  }
}

/*
 * Always Online
 *  ON  -> "available" නැවත නැවතත් යවනවා (online ම තියෙන්න)
 *  OFF -> "unavailable" නැවත නැවතත් යවනවා.
 *         කලින් OFF කරපු වෙලාවේ එක පාරක් විතරයි යැවුවේ; bot එක message එකක් යවද්දී / ලැබෙද්දී
 *         WhatsApp අපිව ආයෙත් "online" කරනවා. දැන් තත්පර 10කට සැරයක් OFF එක ආයෙත් එබීම කරනවා.
 */
function ensureTimer() {
  if (timer) return;
  timer = setInterval(async () => {
    try {
      if (mongoose.connection.readyState !== 1 || !socks.size) return;
      const s = await getSettings();
      await applyPresenceAll(Boolean(s.alwaysOnline));
    } catch {}
  }, 10000);
}

/* =========================
   EVENTS: WELCOME / GOODBYE / CALLS
========================= */

const hooked = new WeakSet();

function hookEvents(sock) {
  if (!sock?.ev || hooked.has(sock)) return;
  hooked.add(sock);

  /* Welcome / Goodbye */
  sock.ev.on("group-participants.update", async update => {
    try {
      if (mongoose.connection.readyState !== 1) return;

      const { id: groupJid, participants = [], action } = update || {};
      if (!groupJid) return;

      // global + ඒ group එකේ overrides (.gset)
      const s = await effectiveSettings(await getSettings(), groupJid);

      const isAdd = action === "add";
      const isLeave = action === "remove" || action === "leave";

      let removedFake = new Set();

      if (isAdd && s.antiFake) {
        try {
          removedFake = await runAntiFake(sock, groupJid, participants, s);
        } catch (error) {
          if (s.debugMode) console.error("AntiFake error:", error.message);
        }
      }

      if ((isAdd && !s.welcome) || (isLeave && !s.goodbye) || (!isAdd && !isLeave)) return;

      metaCache.delete(groupJid);
      let subject = "Group";
      let count = "";
      try {
        const meta = await getGroupMeta(sock, groupJid);
        subject = meta.subject || subject;
        count = meta.participants?.length ?? "";
      } catch {}

      for (const p of participants) {
        const jid = typeof p === "string" ? p : p?.phoneNumber || p?.id;
        if (!jid) continue;

        // Anti Fake එකෙන් අයින් කරපු අයට welcome / goodbye යවන්නේ නෑ
        if (removedFake.has(jid) || (isLeave && wasFakeKicked(clean(jid)))) continue;

        const text = fill(isAdd ? s.welcomeText : s.goodbyeText, {
          user: `@${clean(jid)}`,
          group: subject,
          count
        });

        let image = null;
        if (s.welcomePic) {
          try {
            image = await sock.profilePictureUrl(jid, "image");
          } catch {}
        }

        try {
          if (image) {
            await sock.sendMessage(groupJid, { image: { url: image }, caption: text, mentions: [jid] });
          } else {
            await sock.sendMessage(groupJid, { text, mentions: [jid] });
          }
        } catch (error) {
          if (s.debugMode) console.error("Welcome/Goodbye send error:", error.message);
        }
      }
    } catch (error) {
      console.error("Group event error:", error.message);
    }
  });

  sock.ev.on("groups.update", updates => {
    for (const u of updates || []) metaCache.delete(u.id);
  });

  /* Anti Call */
  sock.ev.on("call", async calls => {
    try {
      if (mongoose.connection.readyState !== 1) return;
      const s = await getSettings();
      if (!s.antiCall) return;

      for (const c of calls || []) {
        if (c.status !== "offer") continue;
        const ids = [c.from, c.callerPn].filter(Boolean).map(clean);
        if (ids.includes(OWNER_NUMBER)) continue;

        await sock.rejectCall(c.id, c.from);
        if (s.callMessage) await sock.sendMessage(c.from, { text: s.callMessage });
        if (s.antiCallBlock) await sock.updateBlockStatus(c.from, "block");
      }
    } catch (error) {
      console.error("Anti call error:", error.message);
    }
  });
}

function init(sock) {
  currentSock = sock;
  socks.add(sock);
  ensureTimer();
  hookEvents(sock);
}

/* =========================
   PER-GROUP SETTINGS  (.gset)
   Group එකකට වෙනම ON/OFF — නැත්නම් global settings පාවිච්චි වෙනවා.
========================= */

const groupCache = new Map();
const fakeKicked = new Map();

const groupCol = () => mongoose.connection.collection("groupsettings");

async function getGroupOverrides(jid) {
  if (!jid || !jid.endsWith("@g.us") || mongoose.connection.readyState !== 1) return {};

  const hit = groupCache.get(jid);
  if (hit && Date.now() - hit.at < 10000) return hit.data;

  let data = {};

  try {
    const doc = await groupCol().findOne({ _id: jid });
    data = doc?.overrides || {};
  } catch (error) {
    console.error("Group settings error:", error.message);
  }

  groupCache.set(jid, { at: Date.now(), data });
  return data;
}

// global settings + (group එකක් නම්) ඒ group එකේ overrides
async function effectiveSettings(base, jid) {
  const overrides = await getGroupOverrides(jid);
  if (!Object.keys(overrides).length) return base;

  const plain = typeof base?.toObject === "function" ? base.toObject() : { ...base };
  return { ...plain, ...overrides };
}

const GROUP_KEYS = {
  antilink: { field: "antiLink", label: "Anti Link", emoji: "🔗", type: "bool" },
  badword: { field: "antiBadword", label: "Anti Badword", emoji: "🤬", type: "bool" },
  spam: { field: "antiSpam", label: "Anti Spam", emoji: "🚷", type: "bool" },
  fake: { field: "antiFake", label: "Anti Fake", emoji: "🛂", type: "bool" },
  welcome: { field: "welcome", label: "Welcome", emoji: "👋", type: "bool" },
  goodbye: { field: "goodbye", label: "Goodbye", emoji: "😢", type: "bool" },
  punish: { field: "punishAction", label: "Punishment", emoji: "⚖️", type: "enum", options: ["delete", "warn", "kick"] },
  warnlimit: { field: "warnLimit", label: "Warn Limit", emoji: "⚠️", type: "number", min: 1, max: 10 }
};

function groupValue(spec, value) {
  if (spec.type === "bool") return onOff(value);
  if (spec.type === "enum") return `🔀 ${String(value).toUpperCase()}`;
  return `🔢 ${value}`;
}

async function groupSettingsCommand(sock, msg, args) {
  const jid = msg.key.remoteJid;
  const reply = t => sock.sendMessage(jid, { text: t }, { quoted: msg });

  if (!jid.endsWith("@g.us")) return reply("👥 This command works in groups only.");
  if (mongoose.connection.readyState !== 1) return reply("❌ Database is not connected.");

  const meta = await getGroupMeta(sock, jid);

  if (!isOwner(msg) && !isAdminIn(meta, senderIds(msg))) {
    return reply("🛡️ Group admins only.");
  }

  const base = await getSettings(true);
  const prefix = base.prefix || ".";
  const overrides = await getGroupOverrides(jid);
  const sub = String(args[0] || "").toLowerCase();

  /* Panel */
  if (!sub) {
    let m = `╭━━〔 👥 GROUP SETTINGS 〕━━╮\n`;
    m += `┃ 📛 ${meta.subject || "Group"}\n`;
    m += `╰━━━━━━━━━━━━━━━━━━━╯\n\n`;

    for (const [key, spec] of Object.entries(GROUP_KEYS)) {
      const own = spec.field in overrides;
      const value = own ? overrides[spec.field] : base[spec.field];

      m += `${spec.emoji} *${key}*  ➜  ${groupValue(spec, value)}  _${own ? "(this group)" : "(default)"}_\n`;
    }

    m += `\n🎯 *HOW TO USE*\n`;
    m += `• ${prefix}gset antilink on\n`;
    m += `• ${prefix}gset antilink off\n`;
    m += `• ${prefix}gset antilink default\n`;
    m += `• ${prefix}gset punish kick\n`;
    m += `• ${prefix}gset warnlimit 5\n`;
    m += `• ${prefix}gset reset  _(everything back to default)_\n\n`;
    m += `ℹ️ _"default" = the bot-wide value from ${prefix}settings._`;

    return reply(m);
  }

  /* Reset */
  if (sub === "reset") {
    await groupCol().deleteOne({ _id: jid });
    groupCache.delete(jid);
    return reply("✅ This group's settings were reset to default.");
  }

  const spec = GROUP_KEYS[sub];
  if (!spec) return reply(`❌ Unknown option *${sub}*.\nSend *${prefix}gset* to see the list.`);

  const raw = String(args[1] || "").toLowerCase();

  if (!raw) {
    const hint =
      spec.type === "bool" ? "on | off | default"
      : spec.type === "enum" ? `${spec.options.join(" | ")} | default`
      : `${spec.min}-${spec.max} | default`;

    return reply(`${spec.emoji} *${spec.label}*\nUsage: ${prefix}gset ${sub} ${hint}`);
  }

  let update;
  let shown;

  if (raw === "default") {
    update = { $unset: { [`overrides.${spec.field}`]: "" } };
    shown = `default (${groupValue(spec, base[spec.field])})`;
  } else {
    let value;

    if (spec.type === "bool") {
      value = parseBool(raw);
      if (value === null) return reply("❌ Use *on*, *off* or *default*.");
    } else if (spec.type === "enum") {
      if (!spec.options.includes(raw)) return reply(`❌ Choose: ${spec.options.join(" / ")}`);
      value = raw;
    } else {
      value = parseInt(raw, 10);
      if (Number.isNaN(value) || value < spec.min || value > spec.max) {
        return reply(`❌ Enter a number between ${spec.min} and ${spec.max}.`);
      }
    }

    update = { $set: { [`overrides.${spec.field}`]: value } };
    shown = groupValue(spec, value);
  }

  await groupCol().updateOne({ _id: jid }, update, { upsert: true });
  groupCache.delete(jid);

  let note = "";
  const turnedOn = spec.type === "bool" && raw !== "off";

  if (turnedOn && !isAdminIn(meta, botIds(sock)) && ["antiLink", "antiBadword", "antiFake"].includes(spec.field)) {
    note = "\n\n⚠️ Make the bot a group admin, otherwise it can't delete messages or remove members.";
  }

  return reply(`✅ ${spec.label} → *${shown}*${raw === "default" ? "" : " _(this group)_"}${note}`);
}

/* =========================
   ANTI FAKE (country filter)
   Group එකට allowed country code නැති (default 94) number එකක් add වුණොත් auto remove.
========================= */

function wasFakeKicked(num) {
  const t = fakeKicked.get(num);
  if (!t) return false;
  if (Date.now() - t > 60000) {
    fakeKicked.delete(num);
    return false;
  }
  return true;
}

async function runAntiFake(sock, groupJid, participants, s) {
  const removed = new Set();
  const codes = (s.allowedCountryCodes || []).map(String).filter(Boolean);

  if (!codes.length) return removed;

  metaCache.delete(groupJid);
  const meta = await getGroupMeta(sock, groupJid);

  if (!isAdminIn(meta, botIds(sock))) return removed;

  const botNums = botIds(sock).filter(Boolean).map(clean);

  for (const p of participants) {
    const jid = typeof p === "string" ? p : p?.phoneNumber || p?.id;

    // @lid වල රට හොයාගන්න බැහැ — එහෙම අය අත් නොහරිනවා
    if (!jid || !String(jid).endsWith("@s.whatsapp.net")) continue;

    const num = clean(jid);

    if (!num || num === OWNER_NUMBER || botNums.includes(num)) continue;
    if (codes.some(c => num.startsWith(c))) continue;

    const removeId = typeof p === "string" ? p : p?.id || jid;

    try {
      await sock.groupParticipantsUpdate(groupJid, [removeId], "remove");
      removed.add(jid);
      fakeKicked.set(num, Date.now());

      await sock.sendMessage(groupJid, {
        text: `🚫 @${num} was removed — only +${codes.join(" / +")} numbers are allowed in this group.`,
        mentions: [jid]
      });
    } catch (error) {
      if (s.debugMode) console.error("AntiFake error:", error.message);
    }

    await sleep(1000);
  }

  return removed;
}

/* =========================
   GROUP PROTECTION
========================= */

const LINK_GLOBAL = /(?:https?:\/\/|www\.|chat\.whatsapp\.com\/)[^\s]+/gi;
const YT_REGEX = /(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)[\w-]{6,}/i;

const spamMap = new Map();
const spamWarned = new Map();
const repliedAt = new Map();
const strikes = new Map();

async function guardContext(sock, msg, needBotAdmin) {
  const jid = msg.key.remoteJid;
  if (!jid.endsWith("@g.us") || isOwner(msg)) return null;

  const meta = await getGroupMeta(sock, jid);
  const sender = msg.key.participant || msg.key.participantAlt;
  if (!sender) return null;
  if (isAdminIn(meta, [sender, msg.key.participantAlt])) return null;
  if (needBotAdmin && !isAdminIn(meta, botIds(sock))) return null;

  return { jid, sender, meta };
}

async function punish(sock, ctx, msg, s, reason, strike = true) {
  const { jid, sender, meta } = ctx;
  const botAdmin = isAdminIn(meta, botIds(sock));
  const tag = `@${clean(sender)}`;
  const say = text => sock.sendMessage(jid, { text, mentions: [sender] });

  if (botAdmin) {
    try {
      await sock.sendMessage(jid, { delete: msg.key });
    } catch {}
  }
  if (!strike) return;

  const kick = async () => {
    await say(`🚫 ${tag} removed: ${reason}`);
    await sock.groupParticipantsUpdate(jid, [sender], "remove").catch(() => {});
  };

  if (s.punishAction === "kick" && botAdmin) return kick();

  if (s.punishAction === "warn") {
    const key = `${jid}:${clean(sender)}`;
    const n = (strikes.get(key) || 0) + 1;

    if (n >= s.warnLimit) {
      strikes.delete(key);
      if (botAdmin) return kick();
      return say(`⚠️ ${tag} ${reason} (warning limit reached)`);
    }

    strikes.set(key, n);
    return say(`⚠️ ${tag} ${reason} (warning ${n}/${s.warnLimit})`);
  }

  return say(`🚫 ${tag} ${reason}`);
}

function linkAllowed(text, allowed) {
  const links = text.match(LINK_GLOBAL) || [];
  if (!links.length) return true;
  if (!allowed.length) return false;

  return links.every(link => {
    const host = link
      .replace(/^https?:\/\//i, "")
      .replace(/^www\./i, "")
      .split(/[/?#]/)[0]
      .toLowerCase();
    return allowed.some(d => host === d || host.endsWith(`.${d}`));
  });
}

async function runAntiLink(sock, msg, s, text) {
  if (!msg.key.remoteJid.endsWith("@g.us") || !LINK_GLOBAL.test(text)) {
    LINK_GLOBAL.lastIndex = 0;
    return false;
  }
  LINK_GLOBAL.lastIndex = 0;

  if (linkAllowed(text, s.allowedDomains || [])) return false;

  const ctx = await guardContext(sock, msg, true);
  if (!ctx) {
    if (s.debugMode) console.log("[ANTILINK] skipped (owner/admin or bot not admin)");
    return false;
  }

  await punish(sock, ctx, msg, s, "links are not allowed here!");
  return true;
}

async function runAntiBadword(sock, msg, s, text) {
  const words = s.badWords || [];
  if (!words.length || !msg.key.remoteJid.endsWith("@g.us")) return false;

  const low = text.toLowerCase();
  if (!words.some(w => low.includes(w))) return false;

  const ctx = await guardContext(sock, msg, true);
  if (!ctx) return false;

  await punish(sock, ctx, msg, s, "used a banned word!");
  return true;
}

async function runAntiSpam(sock, msg, s) {
  const jid = msg.key.remoteJid;
  if (!jid.endsWith("@g.us") || isOwner(msg)) return false;

  const sender = msg.key.participant || msg.key.participantAlt;
  if (!sender) return false;

  const key = `${jid}:${clean(sender)}`;
  const now = Date.now();

  const list = (spamMap.get(key) || []).filter(t => now - t < 8000);
  list.push(now);
  spamMap.set(key, list);

  if (list.length < (s.spamLimit || 6)) return false;

  const ctx = await guardContext(sock, msg, false);
  if (!ctx) return false;

  const canStrike = now - (spamWarned.get(key) || 0) > 30000;
  if (canStrike) spamWarned.set(key, now);

  await punish(sock, ctx, msg, s, "please don't spam!", canStrike);
  return true;
}

/* =========================
   ANTI DELETE / ANTI VIEW-ONCE
========================= */

const store = new Map();

function remember(msg) {
  const id = msg?.key?.id;
  const jid = msg?.key?.remoteJid;
  if (!id || !jid || !msg.message) return;
  if (jid === "status@broadcast" || jid.endsWith("@newsletter")) return;
  if (unwrap(msg.message)?.protocolMessage) return;

  store.set(id, msg);
  if (store.size > 800) store.delete(store.keys().next().value);
}

async function runAntiDelete(sock, msg, s) {
  const pm = unwrap(msg.message)?.protocolMessage;
  if (!pm || !(pm.type === 0 || pm.type === "REVOKE") || !pm.key?.id) return false;
  if (!s.antiDelete) return true;

  const orig = store.get(pm.key.id);
  if (!orig || orig.key.fromMe) return true;

  const chat = orig.key.remoteJid;
  const sender = orig.key.participant || orig.key.participantAlt || chat;

  let where = "💬 Private chat";
  if (chat.endsWith("@g.us")) {
    try {
      where = `👥 ${(await getGroupMeta(sock, chat)).subject || "Group"}`;
    } catch {
      where = "👥 Group";
    }
  }

  const head = `🗑️ *Deleted message detected*\n👤 @${clean(sender)}\n${where}`;
  const target = s.antiDeleteTarget === "chat" ? chat : OWNER_JID;
  const mentions = [sender];

  const m = unwrap(orig.message);
  const kind = ["imageMessage", "videoMessage", "audioMessage", "stickerMessage", "documentMessage"].find(k => m?.[k]);

  if (!kind) {
    const text = getText(orig);
    if (!text) return true;
    await sock.sendMessage(target, { text: `${head}\n\n${text}`, mentions });
    return true;
  }

  let buffer;
  try {
    buffer = await downloadMediaMessage(orig, "buffer", {});
  } catch {
    await sock.sendMessage(target, { text: `${head}\n\n(media could not be recovered)`, mentions });
    return true;
  }

  const caption = m[kind]?.caption ? `${head}\n\n${m[kind].caption}` : head;

  if (kind === "imageMessage") {
    await sock.sendMessage(target, { image: buffer, caption, mentions });
  } else if (kind === "videoMessage") {
    await sock.sendMessage(target, { video: buffer, caption, mentions });
  } else if (kind === "documentMessage") {
    await sock.sendMessage(target, {
      document: buffer,
      mimetype: m.documentMessage.mimetype || "application/octet-stream",
      fileName: m.documentMessage.fileName || "file",
      caption,
      mentions
    });
  } else if (kind === "audioMessage") {
    await sock.sendMessage(target, { audio: buffer, mimetype: m.audioMessage.mimetype || "audio/mp4" });
    await sock.sendMessage(target, { text: head, mentions });
  } else {
    await sock.sendMessage(target, { sticker: buffer });
    await sock.sendMessage(target, { text: head, mentions });
  }

  return true;
}

async function runAntiViewOnce(sock, msg) {
  const raw = msg.message;
  const wrapped = raw?.viewOnceMessage || raw?.viewOnceMessageV2 || raw?.viewOnceMessageV2Extension;
  const inner = unwrap(raw);
  const media = inner?.imageMessage || inner?.videoMessage || inner?.audioMessage;
  if (!media || !(wrapped || media.viewOnce)) return;

  const buffer = await downloadMediaMessage(msg, "buffer", {});
  const sender = msg.key.participant || msg.key.participantAlt || msg.key.remoteJid;
  const where = msg.key.remoteJid.endsWith("@g.us") ? "👥 Group" : "💬 Private chat";
  const caption = `👁️ *View-once revealed*\n👤 @${clean(sender)}\n${where}`;
  const mentions = [sender];

  if (inner.imageMessage) {
    await sock.sendMessage(OWNER_JID, { image: buffer, caption, mentions });
  } else if (inner.videoMessage) {
    await sock.sendMessage(OWNER_JID, { video: buffer, caption, mentions });
  } else {
    await sock.sendMessage(OWNER_JID, { audio: buffer, mimetype: inner.audioMessage.mimetype || "audio/mp4" });
    await sock.sendMessage(OWNER_JID, { text: caption, mentions });
  }
}

/* =========================
   MEDIA FEATURES
========================= */

async function runAutoSticker(sock, msg, s) {
  const m = unwrap(msg.message);
  const isImage = Boolean(m?.imageMessage);
  const isVideo = Boolean(m?.videoMessage);
  if (!isImage && !isVideo) return;
  if (isVideo && (m.videoMessage.seconds || 0) > 10) return;

  const { Sticker, StickerTypes } = await import("wa-sticker-formatter");

  const buffer = await downloadMediaMessage(msg, "buffer", {});
  const sticker = new Sticker(buffer, {
    pack: s.stickerPack || "SHAN MINI BOT",
    author: s.stickerAuthor || "Kingdom of Devil",
    type: s.autoCrop ? StickerTypes.CROPPED : StickerTypes.FULL,
    quality: 50
  });

  await sock.sendMessage(
    msg.key.remoteJid,
    { sticker: await sticker.toBuffer() },
    { quoted: msg }
  );
}

async function runAutoDownload(sock, msg, text) {
  const url = text.match(YT_REGEX)?.[0];
  if (!url) return;

  const full = url.startsWith("http") ? url : `https://${url}`;
  const mod = await import(`./video.js?v=${Date.now()}`);
  await mod.default.execute(sock, msg, [full]);
}

/* =========================
   FEATURES (every message)
========================= */

async function runFeatures(sock, msg) {
  const jid = msg?.key?.remoteJid;
  if (!jid || jid === "status@broadcast" || jid.endsWith("@newsletter")) return;
  if (msg.key.fromMe) return;
  if (!msg.message || msg.message.protocolMessage || msg.message.reactionMessage) return;
  if (mongoose.connection.readyState !== 1) return;

  // global settings + ඒ group එකේ overrides (.gset)
  const s = await effectiveSettings(await getSettings(), jid);
  const text = getText(msg).trim();
  const isCommand = Boolean(text) && text.startsWith(s.prefix || ".");

  /* Auto Seen */
  if (s.autoSeen) {
    try {
      await sock.readMessages([msg.key]);
    } catch {}
  }

  /* Anti View-Once */
  if (s.antiViewOnce) {
    try {
      await runAntiViewOnce(sock, msg);
    } catch (error) {
      if (s.debugMode) console.error("AntiViewOnce error:", error.message);
    }
  }

  /* Anti Link / Badword / Spam */
  try {
    if (s.antiLink && text && (await runAntiLink(sock, msg, s, text))) return;
  } catch (error) {
    if (s.debugMode) console.error("AntiLink error:", error.message);
  }

  try {
    if (s.antiBadword && text && (await runAntiBadword(sock, msg, s, text))) return;
  } catch (error) {
    if (s.debugMode) console.error("AntiBadword error:", error.message);
  }

  try {
    if (s.antiSpam && (await runAntiSpam(sock, msg, s))) return;
  } catch (error) {
    if (s.debugMode) console.error("AntiSpam error:", error.message);
  }

  /* Auto Typing / Recording */
  if (s.autoTyping) {
    try {
      await sock.sendPresenceUpdate(s.typingMode || "composing", jid);
      setTimeout(() => {
        sock.sendPresenceUpdate("paused", jid).catch(() => {});
        // Always Online OFF නම් typing වලින් පස්සේ ආයෙත් offline
        if (!s.alwaysOnline) sock.sendPresenceUpdate("unavailable").catch(() => {});
      }, 3000);
    } catch {}
  }

  /* Auto React */
  if (s.autoReact && !isCommand) {
    try {
      const emoji = getRandomEmoji(["❤️", "🔥", "😍", "👍", "😂", "✨", "💯", "😮"]);
      await sock.sendMessage(jid, { react: { text: emoji, key: msg.key } });
    } catch {}
  }

  /* Auto Reply (private chats, once per cooldown per person) */
  if (s.autoReply && !isCommand && !jid.endsWith("@g.us")) {
    const last = repliedAt.get(jid) || 0;
    if (Date.now() - last > (s.autoReplyCooldown || 60) * 60 * 1000) {
      repliedAt.set(jid, Date.now());
      try {
        await sleep(1500);
        await sock.sendMessage(jid, { text: s.autoReplyText }, { quoted: msg });
      } catch {}
    }
  }

  /* Auto Download (YouTube link) */
  if (s.autoDownload && text && !isCommand && YT_REGEX.test(text)) {
    try {
      await runAutoDownload(sock, msg, text);
    } catch (error) {
      if (s.debugMode) console.error("AutoDownload error:", error.message);
    }
    return;
  }

  /* Auto Sticker */
  if (s.autoSticker && !isCommand) {
    try {
      await runAutoSticker(sock, msg, s);
    } catch (error) {
      if (s.debugMode) console.error("AutoSticker error:", error.message);
    }
  }
}

/* =========================
   STATUS (seen / react)
========================= */

async function runStatus(sock, msg) {
  if (msg?.key?.remoteJid !== "status@broadcast") return;
  if (msg?.key?.fromMe === true) return;
  if (mongoose.connection.readyState !== 1) return;

  const s = await getSettings();
  const statusJid = msg?.key?.participant || msg?.key?.participantAlt;
  if (!statusJid) return;

  if (s.statusAutoSeen) {
    try {
      await sock.readMessages([msg.key]);
    } catch (error) {
      console.error("Status seen error:", error.message);
    }
  }

  if (!s.statusAutoReact) return;

  let emoji = s.statusReactEmoji || "❤️";
  if (s.statusReactMode === "random") {
    emoji = getRandomEmoji(s.statusReactEmojis, "❤️");
  }

  await sock.sendMessage(
    "status@broadcast",
    { react: { text: emoji, key: msg.key } },
    { statusJidList: [statusJid] }
  );

  if (s.debugMode) console.log(`[STATUS REACT] ${statusJid} -> ${emoji}`);
}

/* =========================
   PLUGIN
========================= */

export default {
  commands: ["settings", "gset", "groupsettings"],

  async onConnect(sock) {
    init(sock);
    try {
      const s = await getSettings(true);
      await applyPresence(sock, s.alwaysOnline);
    } catch {}
  },

  async execute(sock, msg, args = [], commandName = "settings") {
    const jid = msg.key.remoteJid;
    init(sock);

    // .gset — group admins ට (owner ටත්) group එකේ ම settings
    if (["gset", "groupsettings"].includes(String(commandName).toLowerCase())) {
      try {
        return await groupSettingsCommand(sock, msg, args);
      } catch (error) {
        console.error("Group settings error:", error?.message || error);
        return sock.sendMessage(jid, { text: "❌ Could not update group settings." }, { quoted: msg });
      }
    }

    if (!isOwner(msg)) {
      return sock.sendMessage(
        jid,
        { text: "👑 Only the owner can change settings." },
        { quoted: msg }
      );
    }

    try {
      await sendMenu(sock, jid, msg);
    } catch (error) {
      console.error("Settings error:", error.message);
      await sock.sendMessage(jid, { text: "❌ Unable to load settings." }, { quoted: msg });
    }
  },

  async handleReply(sock, msg, text) {
    const jid = msg.key.remoteJid;
    const value = String(text || "").trim();
    init(sock);

    if (!isOwner(msg)) return;

    const send = t => sock.sendMessage(jid, { text: t }, { quoted: msg });

    try {
      /* Reset */
      if (/^reset$/i.test(value)) {
        return send("⚠️ This will reset *all* settings to default.\nSend *RESET CONFIRM* to continue.");
      }
      if (/^reset confirm$/i.test(value)) {
        await resetAll(await getSettings(true));
        return sendMenu(sock, jid, msg, false, "✅ All settings were reset to default.");
      }

      /* 0 / menu -> menu එක ආයෙත් */
      if (/^(0|menu|back|home)$/i.test(value)) {
        return sendMenu(sock, jid, msg, false);
      }

      let item = null;
      let arg = "";

      /* Legacy commands: PREFIX:! / EMOJI:❤️ */
      const legacy = value.match(/^(prefix|emoji):\s*([\s\S]*)$/i);

      if (legacy) {
        item = ITEMS.get(legacy[1].toLowerCase() === "prefix" ? "1.4" : "6.4");
        arg = legacy[2].trim();
        if (!arg) return send("❌ Value missing.");
      } else {
        /* පරණ code (3.3 වගේ) තවමත් වැඩ කරනවා */
        const dotted = value.match(/^(\d{1,2}\.\d{1,2})(?:\s+([\s\S]+))?$/);

        if (dotted) {
          item = ITEMS.get(dotted[1]);
          arg = dotted[2] || "";
        } else {
          /* සරල අංකය: 14 / 14 off / 6 30 / 4 My text */
          const simple = value.match(/^(\d{1,2})(?:\s+([\s\S]+))?$/);
          if (!simple) return;

          item = BY_NUM.get(Number(simple[1]));
          arg = simple[2] || "";

          if (!item) {
            return send(`❌ No setting with number *${simple[1]}*. Choose 1-${BY_NUM.size}.`);
          }
        }
      }

      if (!item) return;

      const s = await getSettings(true);
      const reply = await applyItem(item, arg, s, sock);

      if (!reply) return;

      // සාර්ථක නම්: confirm line එකයි අලුත් values වලින් menu එකයි එක message එකකින්
      if (reply.startsWith("✅")) {
        return sendMenu(sock, jid, msg, false, reply);
      }

      await send(reply);
    } catch (error) {
      console.error("Settings update error:", error);
      await send("❌ Settings update failed. Please try again.");
    }
  },

  async handleMessage(sock, msg) {
    init(sock);

    try {
      await runStatus(sock, msg);
    } catch (error) {
      console.error("Status handler error:", error.message);
    }

    try {
      if (mongoose.connection.readyState === 1) {
        const s = await getSettings();
        if (s.antiDelete) remember(msg);
        if (await runAntiDelete(sock, msg, s)) return;
      }
    } catch (error) {
      console.error("AntiDelete error:", error.message);
    }

    try {
      await runFeatures(sock, msg);
    } catch (error) {
      console.error("Features error:", error.message);
    }
  },

  /* Use this in index.js before running a command:
     if (!(await settingsPlugin.canUse(msg))) return; */
  async canUse(msg) {
    if (isOwner(msg)) return true;

    const s = await getSettings();
    if (!s.publicMode || s.ownerOnly) return false;

    const banned = new Set(s.bannedUsers || []);
    if (senderIds(msg).some(i => banned.has(i))) return false;

    const isGroup = msg?.key?.remoteJid?.endsWith("@g.us");
    if (s.chatMode === "groups" && !isGroup) return false;
    if (s.chatMode === "private" && isGroup) return false;

    return true;
  },

  async getSettings() {
    return await getSettings();
  }
};
