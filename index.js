import * as baileys from "@whiskeysockets/baileys";
import pino from "pino";
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import dotenv from "dotenv";
import mongoose from "mongoose";
import { t, langOf } from "./lang.js";
dotenv.config();

/* =====================================================
BAILEYS
===================================================== */

const makeWASocket =
  typeof baileys.default === "function"
    ? baileys.default
    : baileys.makeWASocket;

const {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestWaWebVersion
} = baileys;

/* =====================================================
CONFIG
===================================================== */

const SESSION_DIR = process.env.SESSION_DIR || "./sessions";
const PLUGINS_DIR = process.env.PLUGINS_DIR || "./plugins";
const MONGODB_URI = process.env.MONGODB_URI || "";
const DEFAULT_PREFIX = process.env.PREFIX || ".";

/* =====================================================
DEPLOY FOOTER + SOCKET REGISTRY
- හැම text / caption message එකකටම යටින් Deploy link එක වැටෙනවා
- Main bot + pair කරපු sub-bots හැම socket එකක්ම registry එකේ තියෙනවා
  (.sts / .delsts / .broadcast plugins වලට)
- Bot එකට message කරපු අයව (contacts) status list එකට එකතු කරනවා
===================================================== */

const DEPLOY_LINK = "https://shanmd-ukjm.vercel.app";
const FOOTER = `\n\n🚀 Deploy your bot: ${DEPLOY_LINK}`;

globalThis.SHAN_SOCKETS = new Map(); // "main" | subNumber -> { sock, sub }
globalThis.SHAN_CONTACTS = new Map(); // botKey -> Set(jid)

function installFooter(sock) {
  if (sock.__shanFooter) {
    return;
  }

  sock.__shanFooter = true;

  const orig = sock.sendMessage.bind(sock);

  sock.sendMessage = (jid, content, options) => {
    try {
      const j = String(jid || "");

      const skip =
        !content ||
        typeof content !== "object" ||
        content.react ||
        content.delete ||
        content.edit ||
        content.forward ||
        j.endsWith("@newsletter") ||
        j === "status@broadcast";

      if (!skip) {
        if (
          typeof content.text === "string" &&
          !content.text.includes(DEPLOY_LINK)
        ) {
          content = { ...content, text: content.text + FOOTER };
        } else if (
          typeof content.caption === "string" &&
          !content.caption.includes(DEPLOY_LINK)
        ) {
          content = { ...content, caption: content.caption + FOOTER };
        }
      }
    } catch {}

    return orig(jid, content, options);
  };
}

/* ---------- CONTACTS (status එක contacts වලටම පෙන්වන්න) ----------
   Link කරපු account එකේ contact list එක WhatsApp එකෙන් sync කරගෙන
   MongoDB (shan_contacts) එකේ save කරනවා. Restart වුණත් නැති වෙන්නේ නෑ. */

const contactSaveTimers = new Map();

function addContact(botKey, id) {
  let jid = String(id || "");

  if (!jid.endsWith("@s.whatsapp.net")) {
    return;
  }

  jid = `${jid.split("@")[0].split(":")[0]}@s.whatsapp.net`;

  if (!globalThis.SHAN_CONTACTS.has(botKey)) {
    globalThis.SHAN_CONTACTS.set(botKey, new Set());
  }

  globalThis.SHAN_CONTACTS.get(botKey).add(jid);
}

function saveContacts(botKey) {
  clearTimeout(contactSaveTimers.get(botKey));

  contactSaveTimers.set(
    botKey,
    setTimeout(async () => {
      if (!mongoConnected) {
        return;
      }

      try {
        await mongoose.connection.collection("shan_contacts").updateOne(
          { _id: botKey },
          {
            $set: {
              jids: [...(globalThis.SHAN_CONTACTS.get(botKey) || [])],
              updatedAt: new Date()
            }
          },
          { upsert: true }
        );
      } catch {}
    }, 5000)
  );
}

async function loadContacts(botKey) {
  if (!mongoConnected) {
    return;
  }

  try {
    const doc = await mongoose.connection
      .collection("shan_contacts")
      .findOne({ _id: botKey });

    for (const jid of doc?.jids || []) {
      addContact(botKey, jid);
    }
  } catch {}
}

function prepareSocket(sock, subNumber = null) {
  installFooter(sock);

  const key = subNumber ? cleanNumber(subNumber) : "main";

  globalThis.SHAN_SOCKETS.set(key, { sock, sub: Boolean(subNumber) });

  const onContacts = list => {
    for (const c of list || []) {
      addContact(key, c?.id);
      addContact(key, c?.phoneNumber);
    }

    saveContacts(key);
  };

  sock.ev.on("contacts.upsert", onContacts);
  sock.ev.on("contacts.update", onContacts);

  sock.ev.on("messaging-history.set", data => {
    onContacts(data?.contacts);

    for (const chat of data?.chats || []) {
      addContact(key, chat?.id);
    }

    saveContacts(key);
  });

  sock.ev.on("chats.upsert", chats => {
    for (const chat of chats || []) {
      addContact(key, chat?.id);
    }

    saveContacts(key);
  });

  sock.ev.on("connection.update", async update => {
    if (update?.connection === "open") {
      // කලින් save කරපු contacts load කරනවා
      await loadContacts(key);

      // Contact list එක WhatsApp එකෙන් අලුතින්ම sync කරනවා
      setTimeout(async () => {
        try {
          await sock.resyncAppState(["critical_unblock_low"], true);
          console.log(
            `📇 [${key}] Contacts synced: ${globalThis.SHAN_CONTACTS.get(key)?.size || 0}`
          );
        } catch (error) {
          console.log(
            `⚠️ [${key}] Contacts sync failed: ${error?.message || error}`
          );
        }
      }, 8000);
    }

    if (
      update?.connection === "close" &&
      globalThis.SHAN_SOCKETS.get(key)?.sock === sock
    ) {
      globalThis.SHAN_SOCKETS.delete(key);
    }
  });
}

/* =====================================================
AUTO FOLLOW CHANNELS
Bot connect වුණාම මේ channels දෙක auto follow වේ.
(link හෝ 120363xxxx@newsletter JID දෙකම පුළුවන්)
Extra channels env එකෙන්: AUTO_FOLLOW_CHANNELS=link1,link2
===================================================== */

const AUTO_FOLLOW_CHANNELS = [
  // Shan_Mini_Bot 👨‍💻
  "https://whatsapp.com/channel/0029Vb9KJ1dJP210AYAZX61O",
  // Second channel
  "https://whatsapp.com/channel/0029Vb76aeC30LKFzqDBwR2A",
  ...String(process.env.AUTO_FOLLOW_CHANNELS || "")
    .split(",")
    .map(x => x.trim())
    .filter(Boolean)
];

const followedChannels = new Set();

/* =====================================================
WELCOME MESSAGE CONFIG
Logo: ./logo.jpg දාන්න  OR  BOT_LOGO_URL env එකට link එකක්
===================================================== */

const WELCOME_FLAG = path.join(SESSION_DIR, ".welcome_sent");
const LOGO_PATH = process.env.BOT_LOGO_PATH || "./logo.jpg";
const LOGO_URL = process.env.BOT_LOGO_URL || "";

// sendtt plugin එකට කියනවා welcome/follow index එකෙන් කරනවා කියලා
globalThis.SHAN_INDEX_WELCOME = true;

/* =====================================================
NUMBER CLEANER
===================================================== */

function cleanNumber(value = "") {
  return String(value)
    .replace(/@s\.whatsapp\.net/g, "")
    .replace(/@c\.us/g, "")
    .replace(/@lid/g, "")
    .split(":")[0]
    .split("@")[0]
    .replace(/\D/g, "");
}

/* =====================================================
BOT OWNERS
===================================================== */

// Main Owner — ඔයාට විතරක් Owner-only කමාන්ඩ් ක්‍රියාත්මක වේ
const MAIN_OWNER_NUMBER = "94752661225";

// Owner numbers (මෙතනට වෙනත් අංක එකතු කර නැත)
const OWNER_NUMBERS = [MAIN_OWNER_NUMBER].map(cleanNumber);

/* =====================================================
LOGGER
===================================================== */

const logger = pino({
  level: process.env.LOG_LEVEL || "silent"
});

/* =====================================================
MONGODB
===================================================== */

let mongoConnected = false;

async function connectMongo() {
  if (!MONGODB_URI) {
    console.log("⚠️ MONGODB_URI not configured.");
    return;
  }

  try {
    await mongoose.connect(MONGODB_URI);
    mongoConnected = true;
    console.log("✅ MongoDB connected.");
  } catch (error) {
    console.error("❌ MongoDB error:", error?.message || error);
  }
}

/* =====================================================
PREMIUM (per bot)
botId = "main" හෝ sub-bot නම්බර් එක.
botId නැති පරණ records main bot එකට අයිතියි.
===================================================== */

const premiumUsers = () => mongoose.connection.collection("premiumusers");

function getBotId(msg) {
  return msg?.__shanSub ? cleanNumber(msg.__shanSub) || "sub" : "main";
}

const premiumScope = botId =>
  botId === "main"
    ? { $or: [{ botId: "main" }, { botId: { $exists: false } }, { botId: null }] }
    : { botId };

const PREMIUM_NEVER_GATED = new Set([
  "premiumlist", "plist", "addpremium", "delpremium", "premiuminfo",
  "extendpremium", "mypremium", "premiumco", "unpremiumco",
  "premiumcolist", "premiumonly"
]);

async function isPremium(number, botId = "main") {
  const cleaned = cleanNumber(number);

  if (cleaned === cleanNumber(MAIN_OWNER_NUMBER)) {
    return true;
  }

  if (!mongoConnected || !cleaned) {
    return false;
  }

  try {
    const user = await premiumUsers().findOne({
      number: cleaned,
      expiresAt: { $gt: new Date() },
      ...premiumScope(botId)
    });

    return Boolean(user);
  } catch (error) {
    console.error("❌ Premium check error:", error?.message || error);
    return false;
  }
}

async function premiumDeniedText(number, botId, prefix = DEFAULT_PREFIX, lang = "en") {
  let bots = [];

  try {
    const rows = await premiumUsers()
      .find({ number: cleanNumber(number), expiresAt: { $gt: new Date() } })
      .toArray();

    bots = [
      ...new Set(
        rows
          .filter(r => (r.botId || "main") !== botId)
          .map(
            r =>
              cleanNumber(r.botNumber) ||
              ((r.botId || "main") === "main" ? MAIN_OWNER_NUMBER : r.botId)
          )
      )
    ];
  } catch {}

  // Premium තියෙනවා, හැබැයි වෙන bot එකක
  if (bots.length) {
    return t("idx.premium_other", lang, {
      bots: bots.map(n => `• +${n}`).join("\n")
    });
  }

  // Premium කිසිම bot එකක නෑ
  return t("idx.premium_none", lang, { p: prefix });
}

// Plugins (sendtt වගේ) වලට share කරනවා — botId නොදුන්නොත් main bot
globalThis.isPremiumUser = (number, botId = "main") => isPremium(number, botId);

/* =====================================================
PREMIUM-ONLY COMMAND LIST
.premiumonly / .premiumco වලින් දාන list එක (premiumsettings collection).
Main bot + sub-bots සියල්ලටම පොදුයි. තත්පර 30ක් cache කරනවා.
===================================================== */

let premiumOnlyCache = { at: 0, list: [] };

// .premiumco / .unpremiumco වෙනස් කළ ගමන් list එක refresh කරන්න
globalThis.SHAN_CLEAR_PREMIUM_CACHE = () => {
  premiumOnlyCache = { at: 0, list: [] };
};

async function getPremiumOnlyCommands() {
  if (!mongoConnected) {
    return [];
  }

  if (Date.now() - premiumOnlyCache.at < 30000) {
    return premiumOnlyCache.list;
  }

  try {
    const doc = await mongoose.connection
      .collection("premiumsettings")
      .findOne({ _id: "premium_commands" });

    premiumOnlyCache = {
      at: Date.now(),
      list: Array.isArray(doc?.commands)
        ? doc.commands.map(x => String(x).toLowerCase())
        : []
    };
  } catch (error) {
    console.error("❌ Premium-only list error:", error?.message || error);
  }

  return premiumOnlyCache.list;
}

/* =====================================================
PREMIUM EXPIRY
===================================================== */

async function expirePremiumUsers() {
  if (!mongoConnected) {
    return;
  }

  try {
    const col = premiumUsers();

    // පරණ schema එකේ "number" එකට unique index එකක් තිබුණා.
    // ඒක per-bot records වලට බාධාවක් නිසා අයින් කරනවා.
    try {
      await col.dropIndex("number_1");
      console.log("🧹 Old premium unique index removed.");
    } catch {}

    await col.createIndex({ number: 1, botId: 1 });

    const result = await col.deleteMany({ expiresAt: { $lte: new Date() } });

    if (result.deletedCount > 0) {
      console.log(`💎 Expired premium users removed: ${result.deletedCount}`);
    }
  } catch (error) {
    console.error("❌ Premium expiry error:", error?.message || error);
  }
}

/* =====================================================
PLUGIN MAP
(settings plugin එක මෙතනින් access කරන නිසා
 settings section එකට කලින් declare කරලා තියෙනවා)
===================================================== */

const plugins = new Map();
const pluginFiles = new Map();

/* =====================================================
SETTINGS
settings.js plugin එකම settings වල එකම source එක.
(Mongo model එක plugin එකේ — index එකේ වෙනම model එකක් නැහැ,
 එතකොට අලුත් fields strip වෙන්නේ නැහැ)
===================================================== */

function defaultSettings() {
  return {
    publicMode: true,
    ownerOnly: false,
    prefix: DEFAULT_PREFIX,
    chatMode: "all",
    bannedUsers: [],

    alwaysOnline: false,

    autoSeen: false,
    autoReact: false,
    autoTyping: false,
    autoReply: false,

    welcome: false,
    goodbye: false,
    antiLink: false,
    antiSpam: false,

    autoSticker: false,
    autoDownload: false,
    autoCrop: false,

    autoReconnect: true,
    debugMode: false
  };
}

function getSettingsPlugin() {
  const plugin = plugins.get("settings");

  if (plugin && typeof plugin.getSettings === "function") {
    return plugin;
  }

  return null;
}

async function getSettings() {
  const defaults = defaultSettings();

  if (!mongoConnected) {
    return defaults;
  }

  try {
    const plugin = getSettingsPlugin();

    if (plugin) {
      const fromPlugin = await plugin.getSettings();

      if (fromPlugin) {
        return fromPlugin;
      }
    }

    // settings plugin එක load වෙලා නැත්නම් — read only fallback
    const raw = await mongoose.connection
      .collection("botsettings")
      .findOne({});

    return { ...defaults, ...(raw || {}) };
  } catch (error) {
    console.error("❌ Settings error:", error?.message || error);
    return defaults;
  }
}

/* =====================================================
PRESENCE (Always Online)
Setting එක ON නම් "available", OFF නම් "unavailable".
Connect වෙද්දී සහ settings toggle කරපු වෙලාවේ call කරන්න.
===================================================== */

async function applyPresence(sock) {
  try {
    const s = await getSettings();

    await sock.sendPresenceUpdate(
      s.alwaysOnline ? "available" : "unavailable"
    );
  } catch (error) {
    console.error("❌ Presence error:", error?.message || error);
  }
}

globalThis.SHAN_APPLY_PRESENCE = applyPresence;

/* =====================================================
PLUGIN MANAGER MODEL
===================================================== */

const pluginStateSchema = new mongoose.Schema(
  {
    plugin: {
      type: String,
      required: true,
      unique: true,
      index: true
    },
    enabled: {
      type: Boolean,
      default: true
    }
  },
  {
    timestamps: true,
    collection: "pluginstates"
  }
);

const PluginState =
  mongoose.models.PluginState ||
  mongoose.model("PluginState", pluginStateSchema);

/* =====================================================
GET PLUGIN STATE
===================================================== */

async function getPluginState(pluginName) {
  const name = String(pluginName || "").trim().toLowerCase();

  if (!name) {
    return true;
  }

  if (!mongoConnected) {
    return true;
  }

  try {
    let state = await PluginState.findOne({ plugin: name });

    if (!state) {
      state = await PluginState.create({
        plugin: name,
        enabled: true
      });
    }

    return state.enabled !== false;
  } catch (error) {
    console.error(
      `❌ Plugin state error (${name}):`,
      error?.message || error
    );

    return true;
  }
}

/* =====================================================
SET PLUGIN STATE
===================================================== */

async function setPluginState(pluginName, enabled) {
  const name = String(pluginName || "").trim().toLowerCase();

  if (!name) {
    return null;
  }

  if (!mongoConnected) {
    return {
      plugin: name,
      enabled: Boolean(enabled)
    };
  }

  try {
    return await PluginState.findOneAndUpdate(
      { plugin: name },
      {
        plugin: name,
        enabled: Boolean(enabled)
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true
      }
    );
  } catch (error) {
    console.error("❌ Set plugin state error:", error?.message || error);
    return null;
  }
}

/* =====================================================
COMMAND NAME — FIXED
===================================================== */

function getCommandName(command) {
  if (typeof command === "string") {
    return command.trim().toLowerCase() || null;
  }

  if (
    command &&
    typeof command === "object" &&
    typeof command.name === "string"
  ) {
    return command.name.trim().toLowerCase() || null;
  }

  if (command instanceof RegExp) {
    const source = command.source
      .replace(/^\^/, "")
      .replace(/\$$/, "");

    const match = source.match(/^[a-zA-Z0-9_-]+/);

    if (match) {
      return match[0].toLowerCase();
    }
  }

  return null;
}

/* =====================================================
GET PLUGIN COMMANDS
===================================================== */

function getPluginCommands(plugin) {
  const commands = [];

  if (!plugin) {
    return commands;
  }

  const addCommand = value => {
    const name = getCommandName(value);

    if (name) {
      commands.push(name);
    }
  };

  const addAll = value => {
    if (Array.isArray(value)) {
      for (const item of value) {
        addCommand(item);
      }
    } else {
      addCommand(value);
    }
  };

  addAll(plugin.command);
  addAll(plugin.commands);
  addAll(plugin.alias);

  return [...new Set(commands)];
}

/* =====================================================
PLUGIN MANAGER COMMANDS
===================================================== */

const MANAGER_COMMANDS = [
  "pluginon",
  "pluginoff",
  "pluginlist",
  "plugins"
];

/* =====================================================
ALL PLUGIN STATES
===================================================== */

async function getAllPluginStates() {
  const result = [];
  const seen = new Set();

  for (const [command, plugin] of plugins.entries()) {
    if (!plugin) {
      continue;
    }

    if (seen.has(plugin)) {
      continue;
    }

    seen.add(plugin);

    if (MANAGER_COMMANDS.includes(command)) {
      continue;
    }

    const commands = getPluginCommands(plugin);
    const checkCommand = commands[0] || command;
    const enabled = await getPluginState(checkCommand);

    result.push({
      command: checkCommand,
      enabled
    });
  }

  return result;
}

/* =====================================================
PLUGIN ENABLE CHECK
===================================================== */

async function isPluginEnabled(command) {
  const name = String(command || "").trim().toLowerCase();

  if (MANAGER_COMMANDS.includes(name)) {
    return true;
  }

  return await getPluginState(name);
}

/* =====================================================
LOAD PLUGINS
===================================================== */

async function loadPlugins() {
  plugins.clear();
  pluginFiles.clear();

  if (!fs.existsSync(PLUGINS_DIR)) {
    fs.mkdirSync(PLUGINS_DIR, { recursive: true });
  }

  const files = fs.readdirSync(PLUGINS_DIR);

  console.log("");
  console.log("📂 Loading plugins...");
  console.log("");

  for (const file of files) {
    if (!file.endsWith(".js") && !file.endsWith(".mjs")) {
      continue;
    }

    try {
      const fullPath = path.resolve(PLUGINS_DIR, file);
      const url = `${pathToFileURL(fullPath).href}?v=${Date.now()}`;
      const mod = await import(url);

      let plugin = mod.default || mod;

      if (!plugin) {
        console.log(`⚠️ Skipped ${file}: empty export`);
        continue;
      }

      if (typeof plugin === "function") {
        const command = getCommandName(plugin.command);

        if (!command) {
          console.log(`⚠️ Skipped ${file}: function has no command`);
          continue;
        }

        plugins.set(command, plugin);
        pluginFiles.set(command, file);

        console.log(`✅ Plugin loaded: ${file} -> ${command}`);
        continue;
      }

      if (typeof plugin !== "object") {
        console.log(`⚠️ Skipped ${file}: invalid export`);
        continue;
      }

      const commands = getPluginCommands(plugin);

      if (!commands.length) {
        console.log(`⚠️ Skipped ${file}: no command`);
        continue;
      }

      for (const command of commands) {
        plugins.set(command, plugin);
        pluginFiles.set(command, file);
      }

      console.log(`✅ Plugin loaded: ${file} -> ${commands.join(", ")}`);
    } catch (error) {
      console.error(`❌ Plugin load error: ${file}`);
      console.error(error?.stack || error?.message || error);
    }
  }

  console.log("");
  console.log(`📦 Total plugin commands loaded: ${plugins.size}`);
  console.log("");
}

/* =====================================================
MESSAGE WRAPPER
===================================================== */

function createMessageWrapper(sock, msg) {
  const jid = msg?.key?.remoteJid;
  const sender = msg?.key?.participant || jid;

  return {
    ...msg,

    chat: jid,
    sender,
    fromMe: msg?.key?.fromMe || false,

    reply: async text => {
      if (!jid) {
        return;
      }

      return sock.sendMessage(
        jid,
        { text: String(text) },
        { quoted: msg }
      );
    },

    react: async emoji => {
      if (!msg?.key || !jid) {
        return;
      }

      return sock.sendMessage(jid, {
        react: {
          text: String(emoji),
          key: msg.key
        }
      });
    }
  };
}

/* =====================================================
BLOCK CHECK
===================================================== */

async function isNumberBlocked(number) {
  const cleaned = cleanNumber(number);

  if (cleaned === cleanNumber(MAIN_OWNER_NUMBER)) {
    return false;
  }

  const plugin = plugins.get("block");

  if (!plugin || typeof plugin.isBlocked !== "function") {
    return false;
  }

  try {
    return Boolean(await plugin.isBlocked(cleaned));
  } catch (error) {
    console.error("❌ Block check error:", error?.message || error);
    return false;
  }
}

/* =====================================================
GET SENDER
===================================================== */

function getSenderNumber(msg) {
  const key = msg?.key || {};

  if (key.fromMe === true) {
    // Sub-bot එකේ own number එක — main owner ලෙස සලකන්නේ නැහැ
    return msg?.__shanSub || MAIN_OWNER_NUMBER;
  }

  const values = [
    key.senderPn,
    key.participantPn,
    key.participantAlt,
    key.participant,
    key.remoteJidAlt,
    key.remoteJid
  ];

  for (const value of values) {
    if (!value) {
      continue;
    }

    const number = cleanNumber(value);

    if (number === MAIN_OWNER_NUMBER) {
      return MAIN_OWNER_NUMBER;
    }
  }

  for (const value of values) {
    if (!value) {
      continue;
    }

    const number = cleanNumber(value);

    if (number.length >= 8) {
      return number;
    }
  }

  return "";
}

// Banned list එක check කරන්න — sender ගේ possible ids ඔක්කොම
function getSenderIds(msg) {
  const key = msg?.key || {};

  return [
    key.senderPn,
    key.participantPn,
    key.participantAlt,
    key.participant,
    key.remoteJidAlt,
    key.remoteJid
  ]
    .filter(Boolean)
    .map(cleanNumber)
    .filter(Boolean);
}

/* =====================================================
OWNER
===================================================== */

function isOwner(msg) {
  if (msg?.key?.fromMe === true && !msg?.__shanSub) {
    return true;
  }

  const sender = getSenderNumber(msg);

  return OWNER_NUMBERS.includes(cleanNumber(sender));
}

// ප්‍රධාන Owner හඳුනාගැනීම
function isMainOwner(msg) {
  if (msg?.key?.fromMe === true && !msg?.__shanSub) {
    return true;
  }

  return cleanNumber(getSenderNumber(msg)) === MAIN_OWNER_NUMBER;
}

/* =====================================================
OWNER / ADMIN NUMBER CHECK (number එකකින්)
Owner හෝ admin කෙනෙක්ද කියලා බලනවා.
Welcome message / auto-follow skip කරන්න පාවිච්චි වේ.
===================================================== */

async function isOwnerOrAdminNumber(number) {
  const n = cleanNumber(number);

  if (!n) {
    return false;
  }

  if (OWNER_NUMBERS.includes(n)) {
    return true;
  }

  try {
    if (typeof globalThis.SHAN_IS_ADMIN === "function") {
      return Boolean(await globalThis.SHAN_IS_ADMIN(n));
    }
  } catch {}

  return false;
}

/* =====================================================
MESSAGE TEXT
===================================================== */

function getMessageText(msg) {
  let message = msg?.message;

  if (!message) {
    return "";
  }

  if (message.ephemeralMessage?.message) {
    message = message.ephemeralMessage.message;
  }

  if (message.viewOnceMessage?.message) {
    message = message.viewOnceMessage.message;
  }

  if (message.viewOnceMessageV2?.message) {
    message = message.viewOnceMessageV2.message;
  }

  if (message.viewOnceMessageV2Extension?.message) {
    message = message.viewOnceMessageV2Extension.message;
  }

  if (typeof message.conversation === "string") {
    return message.conversation;
  }

  if (typeof message.extendedTextMessage?.text === "string") {
    return message.extendedTextMessage.text;
  }

  if (typeof message.imageMessage?.caption === "string") {
    return message.imageMessage.caption;
  }

  if (typeof message.videoMessage?.caption === "string") {
    return message.videoMessage.caption;
  }

  if (typeof message.documentMessage?.caption === "string") {
    return message.documentMessage.caption;
  }

  return "";
}

/* =====================================================
PARSE COMMAND
===================================================== */

function parseCommand(text, prefix) {
  const value = String(text || "").trim();

  if (!prefix || !value.startsWith(prefix)) {
    return null;
  }

  const body = value.slice(prefix.length).trim();

  if (!body) {
    return null;
  }

  const parts = body.split(/\s+/);
  const command = String(parts.shift() || "").toLowerCase();

  return {
    command,
    args: parts
  };
}

/* =====================================================
QUOTED MESSAGE
===================================================== */

function getQuotedMessage(msg) {
  const message = msg?.message;

  if (!message) {
    return null;
  }

  const context = message.extendedTextMessage?.contextInfo;

  return context?.quotedMessage || null;
}

/* =====================================================
PLUGIN REPLY
===================================================== */

async function handlePluginReply(sock, msg) {
  const text = getMessageText(msg).trim();

  if (!text) {
    return false;
  }

  const quoted = getQuotedMessage(msg);

  if (!quoted) {
    return false;
  }

  const quotedText =
    quoted.conversation ||
    quoted.extendedTextMessage?.text ||
    quoted.imageMessage?.caption ||
    "";

  if (quotedText.includes("SHAN_SETTINGS_MENU_V1")) {
    const plugin = plugins.get("settings");

    if (plugin && typeof plugin.handleReply === "function") {
      try {
        const enabled = await isPluginEnabled("settings");

        if (!enabled) {
          return true;
        }

        await plugin.handleReply(sock, msg, text);

        return true;
      } catch (error) {
        console.error(
          "❌ Settings reply error:",
          error?.stack || error?.message || error
        );

        return true;
      }
    }
  }

  const uniquePlugins = [...new Set(plugins.values())];

  for (const plugin of uniquePlugins) {
    if (typeof plugin.handleReply !== "function") {
      continue;
    }

    if (plugin.replyHandler !== true) {
      continue;
    }

    let pluginEnabled = true;

    for (const [command, registeredPlugin] of plugins.entries()) {
      if (registeredPlugin !== plugin) {
        continue;
      }

      if (MANAGER_COMMANDS.includes(command)) {
        continue;
      }

      pluginEnabled = await isPluginEnabled(command);

      break;
    }

    if (!pluginEnabled) {
      continue;
    }

    try {
      const handled = await plugin.handleReply(sock, msg, text);

      if (handled === true) {
        return true;
      }
    } catch (error) {
      console.error("❌ Plugin reply error:", error?.message || error);
    }
  }

  return false;
}

/* =====================================================
COMMAND COOLDOWN + MAINTENANCE NOTICE STATE
(settings.cmdCooldown / settings.maintenance — .settings → 8.x)
===================================================== */

const cooldownLast = new Map(); // "botId:number" -> last command time
const cooldownWarnedAt = new Map(); // "botId:number" -> last "slow down" reply time
const maintenanceNoticeAt = new Map(); // chat jid -> last maintenance reply time

setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;

  for (const map of [cooldownLast, cooldownWarnedAt, maintenanceNoticeAt]) {
    for (const [key, time] of map) {
      if (time < cutoff) map.delete(key);
    }
  }
}, 5 * 60 * 1000).unref?.();

/* =====================================================
EXECUTE PLUGIN
===================================================== */

async function executePlugin(sock, msg, command, args, settings) {
  const commandName = String(command).toLowerCase().trim();
  const plugin = plugins.get(commandName);

  if (!plugin) {
    console.log(`⚠️ Plugin not found: ${commandName}`);
    return false;
  }

  if (!MANAGER_COMMANDS.includes(commandName)) {
    const enabled = await isPluginEnabled(commandName);

    if (!enabled) {
      console.log(`⛔ Plugin disabled: ${commandName}`);

      if (isOwner(msg)) {
        await sock.sendMessage(
          msg.key.remoteJid,
          {
            text:
              `╭━━〔 🔌 PLUGIN MANAGER 〕━━╮\n\n⛔ PLUGIN DISABLED\n\n📦 Plugin:\n${commandName}\n\n🔴 Status: OFF\n\nEnable:\n${settings.prefix || DEFAULT_PREFIX}pluginon ${commandName}\n\n╰━━━━━━━━━━━━━━━━━━━━━━╯`
          },
          { quoted: msg }
        );
      }

      return true;
    }
  }

  const lang = await langOf(msg);
  const sender = getSenderNumber(msg);
  const owner = isOwner(msg);
  const admin =
    !owner &&
    (typeof globalThis.SHAN_IS_ADMIN === "function"
      ? await globalThis.SHAN_IS_ADMIN(sender)
      : false);

  // Pair කරපු sub-bot එකේ own number එක — තමන්ගේ bot එකේ commands
  // සියල්ලම (private / owner-only mode, block, premium) පාවිච්චි කරන්න පුළුවන්.
  // (Main bot එකේ owner වෙන්නේ නැහැ)
  const subOwner =
    Boolean(msg?.__shanSub) &&
    (msg?.key?.fromMe === true ||
      cleanNumber(sender) === cleanNumber(msg.__shanSub));

  const privileged = owner || subOwner;

  /* ---------- Settings plugin එකේ අලුත් controls ---------- */

  if (!privileged) {
    // Banned users — silent ignore
    const banned = new Set(settings.bannedUsers || []);

    if (getSenderIds(msg).some(id => banned.has(id))) {
      console.log(`🚫 Banned user ignored: ${sender || "Unknown"}`);
      return true;
    }

    // Chat mode: all / groups / private — silent ignore
    const isGroup = String(msg?.key?.remoteJid || "").endsWith("@g.us");

    if (settings.chatMode === "groups" && !isGroup) {
      return true;
    }

    if (settings.chatMode === "private" && isGroup) {
      return true;
    }
  }

  if (!privileged && settings.ownerOnly) {
    await sock.sendMessage(
      msg.key.remoteJid,
      { text: t("idx.owner_only", lang) },
      { quoted: msg }
    );

    return true;
  }

  if (!privileged && !settings.publicMode) {
    await sock.sendMessage(
      msg.key.remoteJid,
      { text: t("idx.private", lang) },
      { quoted: msg }
    );

    return true;
  }

  if (!privileged && sender && (await isNumberBlocked(sender))) {
    await sock.sendMessage(
      msg.key.remoteJid,
      { text: t("idx.blocked", lang) },
      { quoted: msg }
    );

    return true;
  }

  // Maintenance mode — owner / sub-owner විතරයි වැඩ කරන්නේ.
  // එකම chat එකේ විනාඩියකට එක පාරයි notice එක යවන්නේ (spam නොවෙන්න).
  if (!privileged && settings.maintenance) {
    const chat = msg.key.remoteJid;

    if (Date.now() - (maintenanceNoticeAt.get(chat) || 0) > 60000) {
      maintenanceNoticeAt.set(chat, Date.now());

      await sock.sendMessage(
        chat,
        {
          text:
            settings.maintenanceText ||
            "🚧 The bot is under maintenance right now. Please try again later."
        },
        { quoted: msg }
      );
    }

    return true;
  }

  // Command cooldown — owner / sub-owner / bot admin ට නෑ.
  const cooldownSeconds = Number(settings.cmdCooldown) || 0;

  if (cooldownSeconds > 0 && !privileged && !admin && sender) {
    const key = `${getBotId(msg)}:${cleanNumber(sender)}`;
    const now = Date.now();
    const elapsed = now - (cooldownLast.get(key) || 0);

    if (elapsed < cooldownSeconds * 1000) {
      // "slow down" reply එක cooldown window එකකට එක පාරයි
      if (now - (cooldownWarnedAt.get(key) || 0) > cooldownSeconds * 1000) {
        cooldownWarnedAt.set(key, now);

        await sock.sendMessage(
          msg.key.remoteJid,
          {
            text: t("idx.cooldown", lang, {
              s: Math.ceil((cooldownSeconds * 1000 - elapsed) / 1000)
            })
          },
          { quoted: msg }
        );
      }

      return true;
    }

    cooldownLast.set(key, now);
  }

  // Premium (per bot): ප්‍රිමියම් දුන්න bot එකේ විතරයි වැඩ කරන්නේ.
  // Main bot එකේ දුන්න ප්‍රිමියම් sub-bot එකේ වැඩ නෑ (අනිත් පැත්තත් එහෙමමයි).
  // Owner / Admin විතරයි bypass. Sub-bot owner ටත් premium ඕනේ.
  const premiumOnlyList = await getPremiumOnlyCommands();
  const needsPremium =
    plugin.premium === true || premiumOnlyList.includes(commandName);

  if (
    needsPremium &&
    !PREMIUM_NEVER_GATED.has(commandName) &&
    !owner &&
    !admin
  ) {
    const botId = getBotId(msg);

    if (!(await isPremium(sender, botId))) {
      await sock.sendMessage(
        msg.key.remoteJid,
        { text: await premiumDeniedText(sender, botId, settings.prefix || DEFAULT_PREFIX, lang) },
        { quoted: msg }
      );

      return true;
    }
  }

  console.log("");
  console.log(`🔌 Executing plugin: ${commandName}`);
  console.log(`👤 Sender: ${sender || "Unknown"}`);
  console.log(`👑 Owner: ${owner} | Sub-owner: ${subOwner}`);

  try {
    if (typeof plugin.execute === "function") {
      await plugin.execute(sock, msg, args, commandName);

      console.log(`✅ Plugin completed: ${commandName}`);
      return true;
    }

    if (typeof plugin.run === "function") {
      const wrapped = createMessageWrapper(sock, msg);

      await plugin.run({
        sock,
        m: wrapped,
        args,
        config: {
          ...process.env,
          PREFIX: settings.prefix
        }
      });

      console.log(`✅ Plugin completed: ${commandName}`);
      return true;
    }

    if (typeof plugin === "function") {
      const wrapped = createMessageWrapper(sock, msg);
      const text = args.join(" ").trim();

      await plugin(wrapped, {
        conn: sock,
        text,
        usedPrefix: settings.prefix,
        command: commandName
      });

      console.log(`✅ Plugin completed: ${commandName}`);
      return true;
    }

    if (typeof plugin.handleMessage === "function") {
      await plugin.handleMessage(sock, msg, args, commandName);

      console.log(`✅ Plugin completed: ${commandName}`);
      return true;
    }

    console.log(`❌ Plugin "${commandName}" has no supported executor.`);

    return false;
  } catch (error) {
    console.error(
      `❌ ${commandName} error:`,
      error?.stack || error?.message || error
    );

    try {
      await sock.sendMessage(
        msg.key.remoteJid,
        {
          text: t("idx.cmd_error", lang, { msg: error?.message || error })
        },
        { quoted: msg }
      );
    } catch {}

    return true;
  }
}

/* =====================================================
CHANNEL REACT
===================================================== */

async function handleChannelReact(sock, msg) {
  const plugin = plugins.get("activechanreact");

  if (!plugin || typeof plugin.handleMessage !== "function") {
    return;
  }

  const enabled = await isPluginEnabled("activechanreact");

  if (!enabled) {
    return;
  }

  try {
    const handled = await plugin.handleMessage(sock, msg);

    if (handled) {
      console.log("📢 Channel message handled by activechanreact");
    }
  } catch (error) {
    console.error(
      "❌ Channel React Error:",
      error?.stack || error?.message || error
    );
  }
}

/* =====================================================
AUTO SEEN
settings plugin එක load වෙලා තියෙනවා නම් Auto Seen එක
plugin එකම කරනවා (double seen වෙන්නේ නැහැ).
===================================================== */

async function handleAutoSeen(sock, msg, settings) {
  if (!settings.autoSeen) {
    return;
  }

  if (getSettingsPlugin()) {
    return;
  }

  try {
    await sock.readMessages([msg.key]);
  } catch {}
}

/* =====================================================
BACKGROUND PLUGINS
===================================================== */

async function handleBackgroundPlugins(sock, msg) {
  const uniquePlugins = [...new Set(plugins.values())];

  for (const plugin of uniquePlugins) {
    if (!plugin) {
      continue;
    }

    if (typeof plugin.handleMessage !== "function") {
      continue;
    }

    let command = null;

    for (const [registeredCommand, registeredPlugin] of plugins.entries()) {
      if (registeredPlugin === plugin) {
        command = registeredCommand;
        break;
      }
    }

    if (!command) {
      continue;
    }

    if (MANAGER_COMMANDS.includes(command)) {
      continue;
    }

    const enabled = await isPluginEnabled(command);

    if (!enabled) {
      continue;
    }

    try {
      await plugin.handleMessage(sock, msg);
    } catch (error) {
      console.error(
        `❌ Background plugin error: ${command}`,
        error?.stack || error?.message || error
      );
    }
  }
}

/* =====================================================
SETTINGS PLUGIN — ON CONNECT
Always Online / Welcome-Goodbye / Anti Call hooks
connect වුණ ගමන්ම පටන් ගන්න.
(settings plugin එකේ onConnect එක විතරයි call කරන්නේ)
===================================================== */

async function runSettingsOnConnect(sock) {
  const plugin = getSettingsPlugin();

  if (!plugin || typeof plugin.onConnect !== "function") {
    return;
  }

  try {
    await plugin.onConnect(sock);
    console.log("⚙️ Settings plugin connected.");
  } catch (error) {
    console.error(
      "❌ Settings onConnect error:",
      error?.message || error
    );
  }
}

/* =====================================================
MESSAGE STORE (getMessage)
WhatsApp "Waiting for this message" fix: යවපු message එක
decrypt වෙන්නේ නැතිනම් phone එක retry request එකක් එවනවා.
Baileys ඒකට පරණ message එක නැවත ඉල්ලන්නේ getMessage එකෙන්.
මෙතන නැතිනම් retry fail වෙලා "Waiting for this message" ඉතිරි වෙනවා.
Main bot + sub-bots සියල්ලටම පොදුයි.
===================================================== */

const MESSAGE_STORE = new Map();
const MESSAGE_STORE_LIMIT = 3000;

function storeMessage(msg) {
  const id = msg?.key?.id;

  if (!id || !msg?.message) {
    return;
  }

  MESSAGE_STORE.set(id, msg);

  if (MESSAGE_STORE.size > MESSAGE_STORE_LIMIT) {
    const oldest = MESSAGE_STORE.keys().next().value;
    MESSAGE_STORE.delete(oldest);
  }
}

globalThis.SHAN_GET_MESSAGE = async key => {
  return MESSAGE_STORE.get(key?.id)?.message || undefined;
};

/* =====================================================
MESSAGE HANDLER
===================================================== */

function setupMessages(sock, ctx = {}) {
  sock.ev.on("messages.upsert", async update => {
    try {
      const messages = update?.messages || [];

      if (!messages.length) {
        return;
      }

      const settings = await getSettings();

      for (const msg of messages) {
        if (!msg?.message) {
          continue;
        }

        // retry (getMessage) සඳහා message එක save කරනවා
        storeMessage(msg);

        // Sub-bot (pair plugin) message එකක්ද කියලා mark කරනවා
        if (ctx.subNumber) {
          msg.__shanSub = ctx.subNumber;

          // Pair කරපු number එකේම phone එකෙන් type කරපු message ලැබෙනවද බලන්න
          if (msg?.key?.fromMe) {
            console.log(
              `📨 [SUB ${ctx.subNumber}] own message received in ${msg?.key?.remoteJid}`
            );
          }
        }

        const jid = String(msg?.key?.remoteJid || "");

        if (!jid) {
          continue;
        }

        // .sts (status) සඳහා — bot එකට message කරපු අයව contacts වලට එකතු කරනවා
        if (jid.endsWith("@s.whatsapp.net")) {
          const botKey = ctx.subNumber ? cleanNumber(ctx.subNumber) : "main";

          if (!globalThis.SHAN_CONTACTS.has(botKey)) {
            globalThis.SHAN_CONTACTS.set(botKey, new Set());
          }

          globalThis.SHAN_CONTACTS.get(botKey).add(jid);
        }

        if (jid.endsWith("@newsletter")) {
          console.log(`📢 Newsletter message received: ${jid}`);

          await handleChannelReact(sock, msg);
          await handleBackgroundPlugins(sock, msg);

          continue;
        }

        // Status / anti-delete / anti-viewonce / auto features වලට
        // settings plugin එකේ handleMessage මෙතනින් run වෙනවා
        await handleBackgroundPlugins(sock, msg);

        const replyHandled = await handlePluginReply(sock, msg);

        if (replyHandled) {
          continue;
        }

        await handleAutoSeen(sock, msg, settings);

        const text = getMessageText(msg).trim();

        if (!text) {
          continue;
        }

        console.log("📝 MESSAGE TEXT:", JSON.stringify(text));

        const prefix = settings.prefix || DEFAULT_PREFIX;
        const parsed = parseCommand(text, prefix);

        if (!parsed) {
          continue;
        }

        console.log(
          `📥 COMMAND: ${prefix}${parsed.command}` +
            (ctx.subNumber
              ? ` [SUB ${ctx.subNumber}, fromMe=${msg?.key?.fromMe === true}]`
              : "")
        );
        console.log("🧩 ARGS:", parsed.args);

        const result = await executePlugin(
          sock,
          msg,
          parsed.command,
          parsed.args,
          settings
        );

        console.log(`⚙️ EXECUTION RESULT: ${result}`);
        console.log("");
      }
    } catch (error) {
      console.error(
        "❌ messages.upsert error:",
        error?.stack || error?.message || error
      );
    }
  });
}

/* =====================================================
SHARED HELPERS FOR PLUGINS (pair plugin වගේ ඒවාට)
===================================================== */

// Pair plugin එක sub-bot socket එකක් හදපු ගමන් මේක call කරනවා.
// දැන් footer + socket registry එකත් මෙතනින් ඔටෝම වැටෙනවා.
globalThis.SHAN_ATTACH_SOCKET = (sock, ctx = {}) => {
  prepareSocket(sock, ctx.subNumber || null);
  setupMessages(sock, ctx);
};

globalThis.SHAN_IS_OWNER_MSG = isOwner;
globalThis.SHAN_GET_SENDER = getSenderNumber;
globalThis.SHAN_CLEAN_NUMBER = cleanNumber;
globalThis.SHAN_GET_SETTINGS = getSettings;

/* =====================================================
WEB PAIR — main number එකත් pair site එකෙන් pair කරන්න
Railway pair server එක MongoDB (pair_sessions) එකට save කරන
session එක මෙතනින් ./sessions එකට ගන්නවා.
Console code ඕන නම් .env එකේ CONSOLE_PAIR=true දාන්න.
===================================================== */

const PAIR_COL = process.env.PAIR_SITE_COLLECTION || "pair_sessions";
const CONSOLE_PAIR = String(process.env.CONSOLE_PAIR || "").toLowerCase() === "true";

function mainPairNumber() {
  return cleanNumber(process.env.PAIRING_NUMBER || MAIN_OWNER_NUMBER);
}

globalThis.SHAN_MAIN_NUMBER = mainPairNumber();

function mainSessionRegistered() {
  try {
    return (
      JSON.parse(fs.readFileSync(path.join(SESSION_DIR, "creds.json"), "utf8"))
        .registered === true
    );
  } catch {
    return false;
  }
}

async function markMainSite(patch) {
  if (!mongoConnected) {
    return;
  }

  try {
    await mongoose.connection
      .collection(PAIR_COL)
      .updateOne(
        { _id: mainPairNumber() },
        { $set: { ...patch, updatedAt: new Date() } }
      );
  } catch {}
}

// true = session ready, bot start කරන්න පුළුවන්
async function ensureMainSession() {
  if (CONSOLE_PAIR || mainSessionRegistered()) {
    return true;
  }

  if (mongoConnected) {
    try {
      const doc = await mongoose.connection
        .collection(PAIR_COL)
        .findOne({ _id: mainPairNumber() });

      const files = Array.isArray(doc?.files) ? doc.files : [];

      if (doc?.status === "ready" && files.length) {
        fs.rmSync(SESSION_DIR, { recursive: true, force: true });
        fs.mkdirSync(SESSION_DIR, { recursive: true });

        for (const f of files) {
          const name = path.basename(String(f?.name || ""));

          if (name) {
            fs.writeFileSync(path.join(SESSION_DIR, name), String(f.data ?? ""));
          }
        }

        console.log(`🌐 Main session loaded from pair site (${mainPairNumber()})`);
        return true;
      }
    } catch (error) {
      console.error("❌ Pair site session fetch error:", error?.message || error);
    }
  } else {
    console.log("⚠️ MongoDB not connected — cannot get session from pair site.");
  }

  console.log(
    `⏳ Main number ${mainPairNumber()} not paired yet. ` +
      `Open the pair website and pair this number.`
  );

  return false;
}

// Poll නැතුව — pair site එකෙන් session එක save වුණ ගමන් bot start කරනවා (Change Stream)
let mainWatch = null;

function watchMainSession() {
  if (mainWatch) {
    return true;
  }

  if (!mongoConnected) {
    return false;
  }

  try {
    const stream = mongoose.connection
      .collection(PAIR_COL)
      .watch([{ $match: { "documentKey._id": mainPairNumber() } }]);

    mainWatch = stream;

    const closeWatch = () => {
      try {
        stream.close();
      } catch {}

      if (mainWatch === stream) {
        mainWatch = null;
      }
    };

    stream.on("change", () => {
      closeWatch();

      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }

      scheduleReconnect(1500);
    });

    stream.on("error", error => {
      console.error("⚠️ Pair watch error:", error?.message || error);
      closeWatch();

      // Change stream වැඩ නැත්නම් 10s poll එකට fallback
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }

      scheduleReconnect(10000);
    });

    console.log("👂 Waiting for pair site (no polling)...");
    return true;
  } catch (error) {
    console.error("⚠️ Cannot watch pair site:", error?.message || error);
    mainWatch = null;
    return false;
  }
}

/* =====================================================
BOT STATE
===================================================== */

let starting = false;
let reconnectTimer = null;
let currentSocket = null;

let pairingRequested = false;
let pairingNumber = "";

// 500 (Stream Errored / "bad session") retry counter — connect වුණාම reset වෙනවා
let badSessionRetries = 0;
const BAD_SESSION_MAX_RETRIES = 8;

/* =====================================================
DELAY
===================================================== */

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/* =====================================================
AUTO FOLLOW CHANNELS
===================================================== */

async function autoFollowChannels(sock) {
  for (const item of AUTO_FOLLOW_CHANNELS) {
    try {
      const value = String(item || "").trim();

      if (!value) {
        continue;
      }

      let jid = value.match(/\d{8,}@newsletter/i)?.[0] || "";

      if (!jid) {
        const code = value.match(
          /whatsapp\.com\/channel\/([A-Za-z0-9_-]+)/i
        )?.[1];

        if (!code) {
          console.log(`⚠️ Invalid channel link/JID: ${value}`);
          continue;
        }

        const meta = await sock.newsletterMetadata("invite", code);

        jid = meta?.id || "";
      }

      if (!jid) {
        console.log(`⚠️ Channel JID not found for: ${value}`);
        continue;
      }

      if (followedChannels.has(jid)) {
        continue;
      }

      try {
        await sock.newsletterFollow(jid);
        console.log(`📢 Channel followed: ${jid}`);
      } catch (error) {
        // Already following / other follow error
        console.log(
          `ℹ️ Channel follow skipped (${jid}): ${error?.message || error}`
        );
      }

      followedChannels.add(jid);
    } catch (error) {
      console.error(
        "❌ Auto follow error:",
        error?.message || error
      );
    }

    await sleep(2000);
  }
}

/* =====================================================
WELCOME MESSAGE (connect වුණ number එකට logo එක්ක)
===================================================== */

function buildWelcomeText(number, prefix) {
  return (
    `╭─「 💙 SHAN MINI BOT 」─╮\n\n` +
    `👋 Welcome to SHAN MINI BOT!\n\n` +
    `💙 Your WhatsApp is now connected.\n` +
    `📱 Number : ${number}\n` +
    `⚡ Prefix : ${prefix}\n` +
    `🟢 Status : Online\n\n` +
    `✨ Enjoy Your Bot Experience!\n\n` +
    `🚀 Full Version Coming Soon... 💙\n\n` +
    `📢 Follow Our WhatsApp Channel! 👨‍💻\n` +
    `🔗 https://whatsapp.com/channel/0029Vb9KJ1dJP210AYAZX61O\n\n` +
    `╰─「 ⚡ VERSION 1.0 」─╯`
  );
}

// Logo (./logo.jpg හෝ BOT_LOGO_URL) එක්ක welcome message එක යවනවා.
// Main bot එකටයි pair කරපු sub-bots ටයි දෙගොල්ලන්ටම මේක පාවිච්චි වෙනවා.
async function sendWelcomeMessage(sock, number, prefix) {
  const jid = `${number}@s.whatsapp.net`;
  const caption = buildWelcomeText(number, prefix);

  let image = null;

  try {
    if (fs.existsSync(LOGO_PATH)) {
      image = fs.readFileSync(LOGO_PATH);
    } else if (LOGO_URL) {
      image = { url: LOGO_URL };
    }
  } catch {}

  if (image) {
    await sock.sendMessage(jid, { image, caption });
  } else {
    await sock.sendMessage(jid, { text: caption });
  }
}

globalThis.SHAN_SEND_WELCOME = sendWelcomeMessage;

async function sendWelcome(sock, prefix) {
  try {
    // session එකකට එක පාරයි යවන්නේ
    if (fs.existsSync(WELCOME_FLAG)) {
      return;
    }

    const number = cleanNumber(sock.user?.id || "");

    if (!number) {
      return;
    }

    await sendWelcomeMessage(sock, number, prefix);

    if (!fs.existsSync(SESSION_DIR)) {
      fs.mkdirSync(SESSION_DIR, { recursive: true });
    }

    fs.writeFileSync(WELCOME_FLAG, new Date().toISOString());
    console.log("💙 Welcome message sent.");
  } catch (error) {
    console.error("❌ Welcome message error:", error?.message || error);
  }
}

/* =====================================================
RECONNECT
===================================================== */

function scheduleReconnect(delay = 3000) {
  if (reconnectTimer) {
    return;
  }

  console.log(`🔄 Reconnecting in ${Math.ceil(delay / 1000)} seconds...`);

  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;

    try {
      await startBot();
    } catch (error) {
      console.error("❌ Reconnect error:", error?.message || error);
    }
  }, delay);
}

/* =====================================================
DISCONNECT CODE
===================================================== */

function getDisconnectCode(lastDisconnect) {
  return (
    lastDisconnect?.error?.output?.statusCode ||
    lastDisconnect?.error?.statusCode ||
    null
  );
}

/* =====================================================
DISCONNECT MESSAGE
===================================================== */

function getDisconnectMessage(lastDisconnect) {
  return (
    lastDisconnect?.error?.message ||
    lastDisconnect?.error?.output?.payload?.message ||
    "Unknown"
  );
}

/* =====================================================
REQUEST PAIRING
===================================================== */

async function requestPairing(sock, number) {
  try {
    console.log("");
    console.log("⏳ Preparing pairing connection...");

    await sleep(2000);

    console.log("⏳ Requesting WhatsApp pairing code...");

    const code = await sock.requestPairingCode(number);

    console.log("");
    console.log("╭━━〔 WHATSAPP PAIRING CODE 〕━━╮");
    console.log("┃");
    console.log(`┃ 🔐 CODE : ${code}`);
    console.log("┃");
    console.log("╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯");
    console.log("");
    console.log("📱 WhatsApp");
    console.log("   → Settings");
    console.log("   → Linked Devices");
    console.log("   → Link a device");
    console.log("   → Link with phone number instead");
    console.log("");
    console.log("⚡ Enter the code immediately.");
    console.log("");

    return true;
  } catch (error) {
    console.error("");
    console.error("❌ PAIRING CODE ERROR:");
    console.error(error?.stack || error?.message || error);

    return false;
  }
}

/* =====================================================
START BOT
===================================================== */

async function startBot() {
  if (starting) {
    return;
  }

  starting = true;

  try {
    if (!(await ensureMainSession())) {
      starting = false;

      // Change stream එකෙන් බලා ඉන්නවා; නැත්නම් 10s poll; ඒ දෙකටම safety net එකක්
      if (watchMainSession()) {
        scheduleReconnect(10 * 60 * 1000);
      } else {
        scheduleReconnect(10000);
      }

      return;
    }

    console.log("");
    console.log("╭━━〔 SHAN MINI BOT V1 〕━━╮");
    console.log("┃ 🚀 Starting bot...");
    console.log("╰━━━━━━━━━━━━━━━━━━━━━━━━╯");
    console.log("");

    if (!fs.existsSync(SESSION_DIR)) {
      fs.mkdirSync(SESSION_DIR, { recursive: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);

    console.log(`🔐 Session registered: ${state.creds.registered}`);

    let version;

    try {
      if (typeof fetchLatestWaWebVersion !== "function") {
        throw new Error("fetchLatestWaWebVersion is unavailable.");
      }

      console.log("🌐 Fetching latest WhatsApp Web version...");

      const latest = await fetchLatestWaWebVersion();

      version = latest?.version;

      if (!Array.isArray(version) || version.length !== 3) {
        throw new Error("Invalid WhatsApp Web version received.");
      }

      console.log(`🌐 WhatsApp Web version: ${version.join(".")}`);

      console.log(
        `🌐 Version latest: ${latest?.isLatest === false ? "NO" : "YES"}`
      );
    } catch (error) {
      console.error("❌ Failed to fetch WhatsApp Web version:");
      console.error(error?.stack || error?.message || error);

      // පරණ code එකේ මෙතනින් නිකන් return වෙලා bot එක නතර වුණා — දැන් retry කරනවා
      starting = false;
      scheduleReconnect(5000);
      return;
    }

    console.log("🚀 Creating WhatsApp socket...");

    const sock = makeWASocket({
      version,
      auth: state,
      logger,
      printQRInTerminal: false,
      // Always Online setting එකට අනුව applyPresence() එකෙන් handle වෙනවා
      markOnlineOnConnect: false,
      getMessage: globalThis.SHAN_GET_MESSAGE,
      syncFullHistory: false,
      // LID mappings / initial bootstrap sync අවහිර නොකරන්න — FULL history විතරක් skip කරනවා
      shouldSyncHistoryMessage: msg =>
        msg?.syncType !== baileys.proto?.HistorySync?.HistorySyncType?.FULL,
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 60000,
      keepAliveIntervalMs: 30000,
      generateHighQualityLinkPreview: false,
      browser: ["Ubuntu", "Chrome", "20.0.04"]
    });

    currentSocket = sock;

    // Deploy footer + socket registry (.sts / .delsts / .broadcast සඳහා)
    prepareSocket(sock, null);

    sock.ev.on("creds.update", async () => {
      try {
        await saveCreds();
        console.log("💾 Credentials saved.");
      } catch (error) {
        console.error("❌ saveCreds error:", error?.message || error);
      }
    });

    setupMessages(sock);

    sock.ev.on("connection.update", async update => {
      const { connection, lastDisconnect, isNewLogin } = update;

      if (connection === "connecting") {
        console.log("🔄 Connecting to WhatsApp...");
      }

      if (isNewLogin) {
        console.log("🎉 NEW WHATSAPP LOGIN DETECTED!");

        try {
          await saveCreds();
          console.log("💾 New login credentials saved.");
        } catch (error) {
          console.error(
            "❌ New login save error:",
            error?.message || error
          );
        }
      }

      if (connection === "open") {
        starting = false;
        pairingRequested = false;
        pairingNumber = "";

        // Pair site එකට "active" කියලා දැනුම් දෙනවා
        markMainSite({ active: true, activeAt: new Date() });

        console.log("");
        badSessionRetries = 0;
        console.log("╭━━〔 WHATSAPP CONNECTED 〕━━╮");
        console.log("┃");
        console.log("┃ ✅ Status : ONLINE");
        console.log("┃ 🤖 SHAN MINI BOT V1");
        console.log("┃");
        console.log("╰━━━━━━━━━━━━━━━━━━━━━━━━━━╯");
        console.log("");
        console.log(`📦 Active plugin commands: ${plugins.size}`);

        const settings = await getSettings();

        console.log(`🎯 Prefix: ${settings.prefix}`);
        console.log(
          `🟢 Always Online: ${settings.alwaysOnline ? "ON" : "OFF"}`
        );
        console.log("");

        try {
          const states = await getAllPluginStates();
          const disabled = states.filter(x => !x.enabled);

          if (disabled.length) {
            console.log(
              `⛔ Disabled plugins: ${disabled.map(x => x.command).join(", ")}`
            );
          }
        } catch (error) {
          console.error(
            "❌ Plugin status display error:",
            error?.message || error
          );
        }

        console.log("");

        // Settings plugin hooks (Welcome/Goodbye, Anti Call)
        setTimeout(() => runSettingsOnConnect(sock), 1500);

        // Always Online setting එකට අනුව presence set කරනවා
        // (OFF නම් "unavailable" යවනවා)
        setTimeout(() => applyPresence(sock), 3000);

        // Owner / Admin number එකෙන් connect වුණොත්
        // welcome message + auto follow skip කරනවා
        const connectedNumber = cleanNumber(sock.user?.id || "");
        const skipExtras = await isOwnerOrAdminNumber(connectedNumber);

        if (skipExtras) {
          console.log("👑 Owner/Admin number — welcome & auto-follow skipped.");
        } else {
          // Welcome message (logo + connected details)
          setTimeout(() => sendWelcome(sock, settings.prefix), 3000);

          // Auto follow both channels after connect
          setTimeout(() => autoFollowChannels(sock), 5000);
        }
      }

      if (connection === "close") {
        starting = false;

        const statusCode = getDisconnectCode(lastDisconnect);
        const errorMessage = getDisconnectMessage(lastDisconnect);

        console.log("");
        console.log("╭━━〔 CONNECTION CLOSED 〕━━╮");
        console.log(`┃ Status code: ${statusCode || "Unknown"}`);
        console.log(`┃ Reason: ${errorMessage}`);
        console.log("╰━━━━━━━━━━━━━━━━━━━━━━━━━━╯");
        console.log("");

        if (statusCode === DisconnectReason.loggedOut) {
          pairingRequested = false;
          pairingNumber = "";

          console.log("❌ WhatsApp session logged out.");
          console.log(`🗑️ Delete "${SESSION_DIR}" and pair again.`);

          if (!CONSOLE_PAIR) {
            // Pair site record එක "removed" කරලා session මකලා, web pair එකට බලා ඉන්නවා
            await markMainSite({ status: "removed", active: false });

            try {
              fs.rmSync(SESSION_DIR, { recursive: true, force: true });
            } catch {}

            starting = false;
            scheduleReconnect(10000);
          }

          return;
        }

        // 440 — වෙන තැනක (දෙවෙනි instance එකක) එකම session එක open වෙලා.
        // Reconnect කරොත් instance දෙක එකිනෙකා ඇදලා දානවා (loop) — ඒ නිසා නතර කරනවා.
        if (statusCode === DisconnectReason.connectionReplaced) {
          console.log("⚠️ Session replaced by another instance (440).");
          console.log("   එකම session එකෙන් bot එක දෙපාරක් run වෙනවා — පරණ one එක Stop කරන්න.");

          return;
        }

        // 500 — "Stream Errored (ack)" වගේ තාවකාලික error වලටත් Baileys එවන්නේ මේ code එක.
        // ඒක session කැඩුණා කියන එක නෙවෙයි, ඒ නිසා කලින් වගේ bot එක නතර නොකර retry කරනවා.
        if (statusCode === DisconnectReason.badSession) {
          badSessionRetries += 1;

          if (badSessionRetries <= BAD_SESSION_MAX_RETRIES) {
            const delay = Math.min(5000 * badSessionRetries, 30000);

            console.log(
              `⚠️ Stream error (500). Retry ${badSessionRetries}/${BAD_SESSION_MAX_RETRIES}...`
            );

            if (!state.creds.registered) {
              pairingRequested = false;
            }

            scheduleReconnect(delay);

            return;
          }

          pairingRequested = false;
          pairingNumber = "";

          console.log("❌ Bad WhatsApp session (retries exhausted).");
          console.log(`🗑️ Delete "${SESSION_DIR}" and pair again.`);

          return;
        }

        if (statusCode === DisconnectReason.restartRequired) {
          console.log("🔄 WhatsApp requested socket restart.");

          try {
            await saveCreds();
          } catch {}

          scheduleReconnect(1000);

          return;
        }

        if (statusCode === DisconnectReason.connectionClosed) {
          console.log("⚠️ Connection closed.");

          if (!state.creds.registered) {
            pairingRequested = false;
          }

          scheduleReconnect(3000);

          return;
        }

        if (statusCode === DisconnectReason.connectionLost) {
          console.log("⚠️ Connection lost.");

          if (!state.creds.registered) {
            pairingRequested = false;
          }

          scheduleReconnect(3000);

          return;
        }

        if (statusCode === DisconnectReason.timedOut) {
          console.log("⚠️ Connection timed out.");

          if (!state.creds.registered) {
            pairingRequested = false;
          }

          scheduleReconnect(3000);

          return;
        }

        const settings = await getSettings();

        if (settings.autoReconnect === false) {
          console.log("⛔ Auto reconnect disabled.");
          return;
        }

        if (!state.creds.registered) {
          pairingRequested = false;
        }

        scheduleReconnect(5000);
      }
    });

    /* ---------- PAIRING — owner number එකෙන් auto ---------- */

    if (!state.creds.registered) {
      if (!pairingNumber) {
        pairingNumber = cleanNumber(
          process.env.PAIRING_NUMBER || MAIN_OWNER_NUMBER
        );

        console.log(`📱 Using owner number for pairing: ${pairingNumber}`);
      }

      if (!pairingRequested) {
        pairingRequested = true;

        console.log("");
        console.log(`📱 Pairing number: ${pairingNumber}`);

        const success = await requestPairing(sock, pairingNumber);

        if (!success) {
          pairingRequested = false;
          starting = false;
          scheduleReconnect(5000);
        }
      }
    }
  } catch (error) {
    starting = false;

    console.error("");
    console.error("❌ Bot start error:");
    console.error(error?.stack || error?.message || error);
    console.error("");

    scheduleReconnect(5000);
  }
}

/* =====================================================
MAIN
===================================================== */

async function main() {
  console.log("");
  console.log("╭━━━━━━━━━━━━━━━━━━━━━━━━━━╮");
  console.log("┃     SHAN MINI BOT V1     ┃");
  console.log("┃        STARTING...       ┃");
  console.log("╰━━━━━━━━━━━━━━━━━━━━━━━━━━╯");
  console.log("");

  await connectMongo();
  await expirePremiumUsers();
  await loadPlugins();
  await startBot();
}

/* =====================================================
PROCESS ERROR HANDLERS
===================================================== */

process.on("uncaughtException", error => {
  console.error(
    "❌ Uncaught Exception:",
    error?.stack || error?.message || error
  );
});

process.on("unhandledRejection", reason => {
  console.error(
    "❌ Unhandled Rejection:",
    reason?.stack || reason?.message || reason
  );
});

/* =====================================================
SHUTDOWN
===================================================== */

async function shutdown(signal) {
  console.log("");
  console.log(`🛑 ${signal} received. Shutting down...`);

  try {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  } catch {}

  try {
    if (mongoose.connection.readyState) {
      await mongoose.disconnect();
    }
  } catch {}

  currentSocket = null;

  console.log("👋 SHAN MINI BOT stopped.");

  process.exit(0);
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));

/* =====================================================
START
===================================================== */

main().catch(error => {
  console.error(
    "❌ Fatal startup error:",
    error?.stack || error?.message || error
  );

  process.exit(1);
});
