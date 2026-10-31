/* =====================================================
PAIR PLUGIN — Sub-bot manager (SHAN MINI BOT)

Owner සහ Bot Admin ලට වෙනත් number එකකට bot එකක්
pair කරන්න පුළුවන්. Pair code එක වෙනම message එකකින්
එන නිසා ලේසියෙන් copy කරගන්න පුළුවන්.

Commands:
  .pair 94771234567     -> pair code එකක් generate කරනවා
  .unpair 94771234567   -> sub-bot එක අයින් කරනවා (logout + session delete)
  .pairlist             -> sub-bots list

ENV (optional):
  SUB_SESSION_DIR=./sub_sessions
  SUB_BOT_LIMIT=10          (.pair command එකට විතරයි)
  SITE_BOT_LIMIT=0          (pair site එකෙන් එන bots ගාණ, 0 = unlimited)
  PAIR_SITE_COLLECTION=pair_sessions
  PAIR_SITE_POLL_MS=10000

PAIR SITE SYNC:
  Railway pair server එක MongoDB (pair_sessions) එකට save කරන
  sessions මේ plugin එක තත්පර 10කට සැරයක් බලලා, අලුත් ඒවා
  sub-bot විදියට auto start කරනවා.

Install: මේ file එක ./plugins/pair.js විදියට දාන්න.
===================================================== */

import * as baileys from "@whiskeysockets/baileys";
import pino from "pino";
import fs from "fs";
import path from "path";
import mongoose from "mongoose";

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

const SUB_DIR = path.resolve(process.env.SUB_SESSION_DIR || "./sub_sessions");
const MAX_SUB_BOTS = Number(process.env.SUB_BOT_LIMIT || 10);
const PAIR_TIMEOUT_MS = 3 * 60 * 1000;

// Welcome message එක යවන්න කලින් session එක stable වෙන්න දෙන වෙලාව
const WELCOME_DELAY_MS = 10000;

const logger = pino({ level: process.env.LOG_LEVEL || "silent" });

// Plugin reload වුණත් sub-bots නැති නොවෙන්න globalThis එකේ තියාගන්නවා
const bots = (globalThis.__shanSubBots ||= new Map());

/* =====================================================
HELPERS
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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function dirOf(number) {
  return path.join(SUB_DIR, number);
}

function metaPath(number) {
  return path.join(dirOf(number), "meta.json");
}

function readMeta(number) {
  try {
    return JSON.parse(fs.readFileSync(metaPath(number), "utf8")) || {};
  } catch {
    return {};
  }
}

function writeMeta(number, patch) {
  try {
    fs.mkdirSync(dirOf(number), { recursive: true });
    fs.writeFileSync(
      metaPath(number),
      JSON.stringify({ ...readMeta(number), ...patch }, null, 2)
    );
  } catch {}
}

/* ---------- Pair site (MongoDB) helpers ---------- */

const SITE_COLLECTION = process.env.PAIR_SITE_COLLECTION || "pair_sessions";
const SITE_POLL_MS = Number(process.env.PAIR_SITE_POLL_MS || 10000);
const SITE_BOT_LIMIT = Number(process.env.SITE_BOT_LIMIT || 0); // 0 = unlimited

function siteCol() {
  if (mongoose.connection?.readyState !== 1) {
    return null;
  }

  return mongoose.connection.collection(SITE_COLLECTION);
}

async function markSite(number, patch) {
  try {
    await siteCol()?.updateOne(
      { _id: number },
      { $set: { ...patch, updatedAt: new Date() } }
    );
  } catch {}
}

function prettyCode(code) {
  const c = String(code || "");
  return c.length === 8 ? `${c.slice(0, 4)}-${c.slice(4)}` : c;
}

let cachedVersion = null;

async function getVersion() {
  if (cachedVersion) {
    return cachedVersion;
  }

  const latest = await fetchLatestWaWebVersion();

  if (!Array.isArray(latest?.version) || latest.version.length !== 3) {
    throw new Error("Invalid WhatsApp Web version received.");
  }

  cachedVersion = latest.version;

  return cachedVersion;
}

/* =====================================================
DESTROY SUB-BOT
===================================================== */

async function destroy(
  number,
  { deleteSession = true, logout = false, skipMark = false } = {}
) {
  const entry = bots.get(number);

  if (entry) {
    entry.stopped = true;

    if (entry.timer) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }

    if (entry.retry) {
      clearTimeout(entry.retry);
      entry.retry = null;
    }

    if (entry.welcomeTimer) {
      clearTimeout(entry.welcomeTimer);
      entry.welcomeTimer = null;
    }

    if (logout) {
      try {
        await entry.sock?.logout();
      } catch {}
    }

    try {
      entry.sock?.end?.(undefined);
    } catch {}

    bots.delete(number);
  }

  if (deleteSession) {
    try {
      fs.rmSync(dirOf(number), { recursive: true, force: true });
    } catch {}

    // Pair site එකේ record එකත් "removed" කරනවා — නැත්නම් නැවත auto start වෙනවා
    if (!skipMark) {
      await markSite(number, { status: "removed", active: false });
    }
  }
}

/* =====================================================
LAUNCH SUB-BOT
requestCode=true නම් pairing code එක return කරනවා.
===================================================== */

async function launch(
  number,
  { requestCode = false, createdBy = "", onStatus = null } = {}
) {
  const dir = dirOf(number);

  fs.mkdirSync(dir, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(dir);
  const version = await getVersion();

  let entry = bots.get(number);

  if (!entry) {
    entry = {
      number,
      createdBy,
      status: "starting",
      sock: null,
      timer: null,
      retry: null,
      welcomeTimer: null,
      stopped: false,
      reconnects: 0,
      notify: null
    };

    bots.set(number, entry);
  }

  if (createdBy && !entry.createdBy) {
    entry.createdBy = createdBy;
  }

  if (onStatus) {
    entry.notify = onStatus;
  }

  entry.retry = null;
  entry.status = state.creds.registered ? "connecting" : "pairing";

  if (!readMeta(number).createdAt) {
    writeMeta(number, {
      createdBy: entry.createdBy,
      createdAt: new Date().toISOString()
    });
  }

  const sock = makeWASocket({
    version,
    auth: state,
    logger,
    printQRInTerminal: false,
    // Always Online setting එකට අනුව SHAN_APPLY_PRESENCE එකෙන් handle වෙනවා
    markOnlineOnConnect: false,
    getMessage: async key => globalThis.SHAN_GET_MESSAGE?.(key),
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

  entry.sock = sock;

  sock.ev.on("creds.update", async () => {
    try {
      await saveCreds();
    } catch (error) {
      console.error(
        `❌ Sub-bot saveCreds error (${number}):`,
        error?.message || error
      );
    }
  });

  // Main bot එකේ message handler එකම sub-bot එකටත් සම්බන්ධ කරනවා
  if (typeof globalThis.SHAN_ATTACH_SOCKET === "function") {
    globalThis.SHAN_ATTACH_SOCKET(sock, { subNumber: number });
  } else {
    console.log("⚠️ SHAN_ATTACH_SOCKET missing — update index.js.");
  }

  sock.ev.on("connection.update", async update => {
    // පරණ socket එකක events නම් ignore
    if (entry.sock !== sock || entry.stopped) {
      return;
    }

    const { connection, lastDisconnect } = update;

    if (connection === "open") {
      entry.status = "open";
      entry.reconnects = 0;

      if (entry.timer) {
        clearTimeout(entry.timer);
        entry.timer = null;
      }

      console.log(`🤖 Sub-bot connected: ${number}`);

      // Pair site එකට "active" කියලා දැනුම් දෙනවා
      markSite(number, { active: true, activeAt: new Date() });

      const notify = entry.notify;
      entry.notify = null;

      try {
        await notify?.(`✅ Sub-bot connected: +${number}`);
      } catch {}

      // Always Online setting එකට අනුව presence set කරනවා
      setTimeout(() => {
        if (entry.stopped || entry.sock !== sock) {
          return;
        }

        globalThis.SHAN_APPLY_PRESENCE?.(sock);
      }, 3000);

      // Welcome message එක පළවෙනි වතාවට විතරයි.
      // Pairing එකෙන් පස්සේ "restartRequired" එනවා — ඒ නිසා
      // session එක stable වෙනකල් ඉඳලා, socket එක තාම open නම් විතරක් යවනවා.
      if (!readMeta(number).welcomed) {
        if (entry.welcomeTimer) {
          clearTimeout(entry.welcomeTimer);
        }

        entry.welcomeTimer = setTimeout(async () => {
          entry.welcomeTimer = null;

          if (
            entry.stopped ||
            entry.sock !== sock ||
            entry.status !== "open"
          ) {
            return;
          }

          if (readMeta(number).welcomed) {
            return;
          }

          try {
            const settings = await globalThis.SHAN_GET_SETTINGS?.();
            const prefix = settings?.prefix || ".";

            if (typeof globalThis.SHAN_SEND_WELCOME === "function") {
              // index.js එකේ welcome message එකම (logo එක්ක)
              await globalThis.SHAN_SEND_WELCOME(sock, number, prefix);
            } else {
              await sock.sendMessage(`${number}@s.whatsapp.net`, {
                text:
                  `💙 SHAN MINI BOT\n\n` +
                  `✅ Your bot is now connected.\n` +
                  `📱 Number : ${number}\n` +
                  `⚡ Prefix : ${prefix}`
              });
            }

            writeMeta(number, { welcomed: true });
          } catch (error) {
            console.error(
              `❌ Sub-bot welcome error (${number}):`,
              error?.message || error
            );
          }
        }, WELCOME_DELAY_MS);
      }
    }

    if (connection === "close") {
      const statusCode =
        lastDisconnect?.error?.output?.statusCode ||
        lastDisconnect?.error?.statusCode ||
        null;

      if (entry.welcomeTimer) {
        clearTimeout(entry.welcomeTimer);
        entry.welcomeTimer = null;
      }

      if (
        statusCode === DisconnectReason.loggedOut ||
        statusCode === DisconnectReason.badSession
      ) {
        console.log(`❌ Sub-bot logged out / bad session: ${number}`);

        const notify = entry.notify;

        await destroy(number, { deleteSession: true });

        try {
          await notify?.(`❌ +${number} logged out. Session removed.`);
        } catch {}

        return;
      }

      // පරණ socket එක සම්පූර්ණයෙන්ම වහනවා — එකම session එකෙන්
      // socket දෙකක් එකවර ඉන්න එක "Waiting for this message" වලට හේතුවක්.
      try {
        await saveCreds();
      } catch {}

      try {
        sock.ev.removeAllListeners();
        sock.end(undefined);
      } catch {}

      // restartRequired (pairing පස්සේ සාමාන්‍යයෙන් එනවා) හෝ වෙනත් close
      const delay = statusCode === DisconnectReason.restartRequired ? 1000 : 5000;

      entry.reconnects += 1;
      entry.status = "connecting";

      if (entry.retry) {
        return;
      }

      const wait = Math.min(delay * Math.max(1, entry.reconnects), 30000);

      console.log(
        `🔄 Sub-bot ${number} reconnecting in ${Math.ceil(wait / 1000)}s ` +
          `(code: ${statusCode || "Unknown"})`
      );

      entry.retry = setTimeout(() => {
        entry.retry = null;

        if (entry.stopped) {
          return;
        }

        launch(number).catch(error => {
          console.error(
            `❌ Sub-bot reconnect error (${number}):`,
            error?.message || error
          );
        });
      }, wait);
    }
  });

  if (requestCode && !state.creds.registered) {
    await sleep(3000);

    const code = await sock.requestPairingCode(number);

    // Code එක use නොකළොත් session එක clean කරනවා
    entry.timer = setTimeout(() => {
      entry.timer = null;

      const registered =
        entry.status === "open" ||
        entry.sock?.authState?.creds?.registered === true;

      if (registered || entry.stopped) {
        return;
      }

      const notify = entry.notify;

      destroy(number, { deleteSession: true }).finally(() => {
        try {
          notify?.(`⌛ Pairing code for +${number} expired. Run pair again.`);
        } catch {}
      });
    }, PAIR_TIMEOUT_MS);

    return code;
  }

  return null;
}

/* =====================================================
RESTORE SUB-BOTS (bot restart වුණාම)
===================================================== */

async function restoreAll() {
  if (globalThis.__shanSubRestored) {
    return;
  }

  globalThis.__shanSubRestored = true;

  if (!fs.existsSync(SUB_DIR)) {
    return;
  }

  let names = [];

  try {
    names = fs.readdirSync(SUB_DIR);
  } catch {
    return;
  }

  for (const name of names) {
    if (!/^\d{8,15}$/.test(name)) {
      continue;
    }

    const dir = path.join(SUB_DIR, name);

    try {
      if (!fs.statSync(dir).isDirectory()) {
        continue;
      }

      let registered = false;

      try {
        registered =
          JSON.parse(fs.readFileSync(path.join(dir, "creds.json"), "utf8"))
            .registered === true;
      } catch {}

      if (!registered) {
        // Pair කරන්න බැරි වුණු අඩක් session — අයින් කරනවා
        fs.rmSync(dir, { recursive: true, force: true });
        continue;
      }

      console.log(`♻️ Restoring sub-bot: ${name}`);

      await launch(name, { createdBy: readMeta(name).createdBy || "" });
    } catch (error) {
      console.error(
        `❌ Sub-bot restore error (${name}):`,
        error?.message || error
      );
    }

    await sleep(3000);
  }
}

/* =====================================================
SYNC FROM PAIR SITE (MongoDB -> sub-bots)
Railway pair server එකෙන් link කරපු sessions auto start කරනවා.
Panel disk එක මැකුණත් MongoDB එකෙන් නැවත හදාගන්නවා.
===================================================== */

function siteBotCount() {
  return [...bots.values()].filter(b => b.createdBy === "site").length;
}

function hasCreds(number) {
  return fs.existsSync(path.join(dirOf(number), "creds.json"));
}

let siteSyncRunning = false;

async function syncFromSite() {
  if (siteSyncRunning) {
    return;
  }

  siteSyncRunning = true;

  try {
    const col = siteCol();

    if (!col) {
      return;
    }

    const docs = await col
      .find({}, { projection: { status: 1 } })
      .toArray();

    for (const d of docs) {
      const number = String(d._id);

      if (!/^\d{8,15}$/.test(number)) {
        continue;
      }

      // Main number එක index.js එකෙන් handle වෙනවා — sub-bot විදියට නොදාන්න
      if (number === String(globalThis.SHAN_MAIN_NUMBER || "")) {
        continue;
      }

      const entry = bots.get(number);

      if (d.status === "removed") {
        if (entry?.createdBy === "site") {
          await destroy(number, { deleteSession: true, skipMark: true });
        }

        continue;
      }

      if (d.status !== "ready" || entry) {
        continue;
      }

      if (SITE_BOT_LIMIT > 0 && siteBotCount() >= SITE_BOT_LIMIT) {
        console.log(`🚫 Site bot limit reached (${SITE_BOT_LIMIT})`);
        break;
      }

      try {
        if (!hasCreds(number)) {
          const full = await col.findOne({ _id: number });
          const files = Array.isArray(full?.files) ? full.files : [];

          if (!files.length) {
            continue;
          }

          fs.rmSync(dirOf(number), { recursive: true, force: true });
          fs.mkdirSync(dirOf(number), { recursive: true });

          for (const f of files) {
            const name = path.basename(String(f?.name || ""));

            if (!name) {
              continue;
            }

            fs.writeFileSync(path.join(dirOf(number), name), String(f.data ?? ""));
          }
        }

        console.log(`🌐 Site session found, starting sub-bot: ${number}`);

        await launch(number, { createdBy: "site" });
        await markSite(number, { claimedAt: new Date() });
      } catch (error) {
        console.error(
          `❌ Site sync error (${number}):`,
          error?.message || error
        );
      }

      await sleep(3000);
    }
  } catch (error) {
    console.error("❌ Site sync failed:", error?.message || error);
  } finally {
    siteSyncRunning = false;
  }
}

/* MongoDB Change Stream — poll නැතුව, අලුත් session එකක් save වුණ ගමන් trigger වෙනවා.
   Change streams support නැත්නම් (standalone Mongo) පරණ poll එකට fallback වෙනවා. */

let siteDebounce = null;

function triggerSiteSync() {
  clearTimeout(siteDebounce);
  siteDebounce = setTimeout(() => {
    syncFromSite().catch(() => {});
  }, 1500);
}

function startSitePollFallback() {
  if (globalThis.__shanSitePoll) {
    return;
  }

  console.log(`⚠️ Change stream unavailable — polling every ${SITE_POLL_MS / 1000}s`);

  globalThis.__shanSitePoll = setInterval(() => {
    syncFromSite().catch(() => {});
  }, SITE_POLL_MS);
}

function openSiteWatch() {
  if (globalThis.__shanSiteWatch) {
    return;
  }

  const col = siteCol();

  if (!col) {
    setTimeout(openSiteWatch, 5000);
    return;
  }

  try {
    const stream = col.watch([
      {
        $match: {
          $or: [
            { operationType: { $in: ["insert", "replace"] } },
            { "updateDescription.updatedFields.status": { $exists: true } }
          ]
        }
      }
    ]);

    globalThis.__shanSiteWatch = stream;

    stream.on("change", triggerSiteSync);

    stream.on("error", error => {
      console.error("⚠️ Site change stream error:", error?.message || error);

      try {
        stream.close();
      } catch {}

      globalThis.__shanSiteWatch = null;

      // Fallback poll + නැවත watch කරන්න උත්සාහ කරනවා
      startSitePollFallback();
      setTimeout(openSiteWatch, 60000);
    });

    // තත්පර 5ක් error නැතුව ගියොත් watch එක වැඩ — fallback poll එක නවත්තනවා
    setTimeout(() => {
      if (globalThis.__shanSiteWatch === stream && globalThis.__shanSitePoll) {
        clearInterval(globalThis.__shanSitePoll);
        globalThis.__shanSitePoll = null;
      }
    }, 5000);

    console.log("👂 Watching pair site for new sessions (no polling).");
  } catch (error) {
    console.error("⚠️ Cannot open change stream:", error?.message || error);
    globalThis.__shanSiteWatch = null;
    startSitePollFallback();
    setTimeout(openSiteWatch, 60000);
  }
}

function startSiteSync() {
  if (globalThis.__shanSiteSync) {
    return;
  }

  globalThis.__shanSiteSync = true;

  // පළවෙනි වතාවට එකපාර scan කරනවා (bot restart වුණාම sessions ආපහු ගන්න)
  syncFromSite().catch(() => {});

  openSiteWatch();

  // Safety net: විනාඩි 10කට සැරයක් (change stream එකක් මග හැරුණොත්)
  setInterval(() => {
    syncFromSite().catch(() => {});
  }, 10 * 60 * 1000);
}

// Main bot connect වෙන්න කල් දීලා restore කරනවා, ඊට පස්සේ site sync පටන් ගන්නවා
setTimeout(() => {
  restoreAll()
    .catch(error => {
      console.error("❌ Sub-bot restore failed:", error?.message || error);
    })
    .finally(startSiteSync);
}, 10000);

/* =====================================================
PLUGIN
===================================================== */

export default {
  command: "pair",
  alias: ["unpair", "pairlist", "pairdelete", "pairdelate", "delpair"],
  description: "Pair a bot to another number (owner / bot admin only)",

  async execute(sock, msg, args = [], commandName = "pair") {
    const jid = msg.key.remoteJid;

    const reply = text =>
      sock.sendMessage(jid, { text }, { quoted: msg });

    // Sub-bot එකකින් නැවත pair කරන්න බැහැ
    if (msg.__shanSub) {
      return reply("🚫 This command can only be used on the main bot.");
    }

    const sender = globalThis.SHAN_GET_SENDER?.(msg) || "";
    const isOwner = Boolean(globalThis.SHAN_IS_OWNER_MSG?.(msg));

    let isAdmin = false;

    if (!isOwner) {
      try {
        isAdmin =
          typeof globalThis.SHAN_IS_ADMIN === "function"
            ? Boolean(await globalThis.SHAN_IS_ADMIN(sender))
            : false;
      } catch {}
    }

    if (!isOwner && !isAdmin) {
      return reply("👑 This command is for the owner and bot admins only.");
    }

    const settings = await globalThis.SHAN_GET_SETTINGS?.();
    const prefix = settings?.prefix || ".";
    const cmd = String(commandName || "pair").toLowerCase();

    /* ---------------- PAIRLIST ---------------- */

    if (cmd === "pairlist") {
      const rows = [...bots.values()].filter(
        b => isOwner || b.createdBy === sender
      );

      if (!rows.length) {
        return reply("📭 No sub-bots found.");
      }

      const icon = {
        open: "🟢 online",
        connecting: "🟡 connecting",
        pairing: "🔑 waiting for pairing",
        starting: "⏳ starting"
      };

      return reply(
        `🤖 SUB-BOTS (${rows.length}/${MAX_SUB_BOTS})\n\n` +
          rows
            .map(b => `• +${b.number} — ${icon[b.status] || b.status}`)
            .join("\n")
      );
    }

    const number = cleanNumber(args.join(""));

    /* ---------------- UNPAIR ---------------- */

    const DELETE_COMMANDS = ["unpair", "pairdelete", "pairdelate", "delpair"];

    if (DELETE_COMMANDS.includes(cmd)) {
      if (!number) {
        return reply(`❌ Usage:\n${prefix}pairdelete 94771234567`);
      }

      const entry = bots.get(number);
      const meta = readMeta(number);

      if (!entry && !meta.createdAt) {
        return reply(`❌ No sub-bot found for +${number}.`);
      }

      const creator = entry?.createdBy || meta.createdBy || "";

      if (!isOwner && creator !== sender) {
        return reply("🚫 You can only unpair bots that you created.");
      }

      // WhatsApp එකෙන් logout (linked device අයින් වෙනවා) + session delete
      await destroy(number, { deleteSession: true, logout: true });

      return reply(
        `🗑️ Sub-bot +${number} logged out and removed.\n` +
          `Linked device එක ඒ number එකෙන් අයින් වුණා.`
      );
    }

    /* ---------------- PAIR ---------------- */

    if (!number) {
      return reply(
        `🔗 PAIR A BOT\n\n` +
          `Usage:\n${prefix}pair 94771234567\n\n` +
          `• Country code එක්ක number එක දෙන්න (+ නැතුව)\n` +
          `• ${prefix}pairlist — sub-bots list\n` +
          `• ${prefix}pairdelete <number> — logout & remove`
      );
    }

    if (number.startsWith("0")) {
      return reply(
        "❌ Country code එක්ක number එක දෙන්න.\nExample: 94771234567"
      );
    }

    if (number.length < 8 || number.length > 15) {
      return reply("❌ Invalid WhatsApp number.");
    }

    if (number === cleanNumber(sock.user?.id || "")) {
      return reply("⚠️ That number is the main bot itself.");
    }

    const existing = bots.get(number);

    if (existing) {
      if (!isOwner && existing.createdBy !== sender) {
        return reply("🚫 This number is already paired by someone else.");
      }

      if (existing.status === "open") {
        return reply(
          `✅ +${number} is already connected.\n` +
            `Use ${prefix}pairdelete ${number} first to re-pair.`
        );
      }

      // Connect වෙලා නැති පරණ attempt එක අයින් කරනවා
      await destroy(number, { deleteSession: true });
    } else if (fs.existsSync(dirOf(number))) {
      const meta = readMeta(number);

      if (!isOwner && meta.createdBy && meta.createdBy !== sender) {
        return reply("🚫 This number is already paired by someone else.");
      }

      await destroy(number, { deleteSession: true });
    }

    if (bots.size - siteBotCount() >= MAX_SUB_BOTS) {
      return reply(`🚫 Sub-bot limit reached (${MAX_SUB_BOTS}).`);
    }

    await reply(`⏳ Generating pairing code for +${number}...`);

    try {
      const code = await launch(number, {
        requestCode: true,
        createdBy: sender,
        onStatus: async text => {
          try {
            await sock.sendMessage(jid, { text });
          } catch {}
        }
      });

      if (!code) {
        await destroy(number, { deleteSession: true });
        return reply("❌ Could not generate a pairing code. Try again.");
      }

      await reply(
        `🔐 PAIRING CODE for +${number}\n\n` +
          `📱 WhatsApp → Settings → Linked Devices\n` +
          `→ Link a device → Link with phone number instead\n\n` +
          `⚡ Enter the code below within 3 minutes.\n` +
          `👇 Code is in the next message (long press → copy)`
      );

      // Code එක විතරක් වෙනම message එකක් — copy කරන්න ලේසියි
      await sock.sendMessage(jid, { text: prettyCode(code) });
    } catch (error) {
      console.error(
        `❌ Pair error (${number}):`,
        error?.stack || error?.message || error
      );

      await destroy(number, { deleteSession: true });

      return reply(`❌ Pair error\n\n${error?.message || error}`);
    }
  }
};
