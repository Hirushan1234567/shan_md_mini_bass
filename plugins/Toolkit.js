// plugins/toolkit.js
// SHAN MINI BOT V1 — TOOLKIT
// Group moderation (antilink + warn) | Broadcast | Handy tools | Fun
// එක ෆයිල් එකක්, plugin API: execute(sock, msg, args, commandName) + handleMessage(sock, msg)

import fs from "fs";
import path from "path";
import { t, ta, langOf } from "../lang.js";

const BOT_NAME = process.env.BOT_NAME || "SHAN MINI BOT V1";
const MAX_WARNS = Number(process.env.MAX_WARNS) || 3;
const BROADCAST_MAX = Number(process.env.BROADCAST_MAX) || 200;
const DATA_FILE = path.join(process.cwd(), "data", "toolkit.json");

/* =====================================================
   STORAGE (small JSON file, debounced save)
===================================================== */

let db = { antilink: {}, warns: {} };

try {
  if (fs.existsSync(DATA_FILE)) {
    const raw = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    db = { antilink: raw.antilink || {}, warns: raw.warns || {} };
  }
} catch (error) {
  console.error("❌ [toolkit] data load error:", error?.message || error);
}

let saveTimer = null;

function saveDb() {
  clearTimeout(saveTimer);

  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
      fs.writeFileSync(DATA_FILE, JSON.stringify(db));
    } catch (error) {
      console.error("❌ [toolkit] data save error:", error?.message || error);
    }
  }, 1500);

  saveTimer.unref?.();
}

/* =====================================================
   HELPERS
===================================================== */

const clean = v =>
  String(v || "")
    .replace(/@.*$/, "")
    .split(":")[0]
    .replace(/\D/g, "");

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getPrefix() {
  try {
    const s = await globalThis.SHAN_GET_SETTINGS?.();
    if (s?.prefix) return s.prefix;
  } catch {}
  return process.env.PREFIX || ".";
}

function textOf(msg) {
  let m = msg?.message;
  if (!m) return "";
  m = m.ephemeralMessage?.message || m;
  m = m.viewOnceMessage?.message || m;
  m = m.viewOnceMessageV2?.message || m;

  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.documentMessage?.caption ||
    ""
  );
}

const isOwnerMsg = msg => {
  try {
    return Boolean(globalThis.SHAN_IS_OWNER_MSG?.(msg));
  } catch {
    return false;
  }
};

// group metadata cache (60s) — WhatsApp rate limit වලින් බේරෙන්න
const metaCache = new Map();

async function getMeta(sock, jid) {
  const hit = metaCache.get(jid);
  if (hit && Date.now() - hit.at < 60000) return hit.meta;

  const meta = await sock.groupMetadata(jid);
  metaCache.set(jid, { at: Date.now(), meta });
  return meta;
}

const idsOf = p => [p?.id, p?.jid, p?.phoneNumber, p?.lid].filter(Boolean).map(clean);

function adminSet(meta) {
  const set = new Set();
  for (const p of meta?.participants || []) {
    if (p.admin) idsOf(p).forEach(i => set.add(i));
  }
  return set;
}

function senderIds(msg) {
  const k = msg?.key || {};
  return [k.participant, k.participantAlt, k.participantPn, k.senderPn]
    .filter(Boolean)
    .map(clean);
}

function botIds(sock) {
  return [sock?.user?.id, sock?.user?.lid].filter(Boolean).map(clean);
}

function getTarget(msg, args) {
  const ctx = msg?.message?.extendedTextMessage?.contextInfo;

  const mentioned = ctx?.mentionedJid?.[0];
  if (mentioned) return mentioned;

  if (ctx?.participant) return ctx.participant;

  const digits = String(args?.[0] || "").replace(/\D/g, "");
  if (digits.length >= 8) return `${digits}@s.whatsapp.net`;

  return null;
}

/* =====================================================
   COMMAND GUARDS
===================================================== */

async function requireGroupAdmin(sock, msg, reply, lang) {
  const jid = msg.key.remoteJid;

  if (!jid.endsWith("@g.us")) {
    await reply(t("common.group_only", lang));
    return null;
  }

  const meta = await getMeta(sock, jid);

  if (isOwnerMsg(msg) || senderIds(msg).some(i => adminSet(meta).has(i))) {
    return meta;
  }

  await reply(t("common.admins_only", lang));
  return null;
}

/* =====================================================
   ANTILINK  (background — index.js handleMessage)
===================================================== */

const LINK_ALL = /(https?:\/\/|www\.)\S+|chat\.whatsapp\.com\/\S+|wa\.me\/\S+/i;
const LINK_WA = /chat\.whatsapp\.com\/\S+/i;

async function addWarn(sock, jid, targetJid, reason, lang) {
  const key = `${jid}|${clean(targetJid)}`;
  db.warns[key] = (db.warns[key] || 0) + 1;
  saveDb();

  const count = db.warns[key];
  const left = MAX_WARNS - count;

  await sock.sendMessage(jid, {
    text: t("tk.warn_msg", lang, {
      n: count,
      max: MAX_WARNS,
      num: clean(targetJid),
      reason,
      tail: left > 0 ? t("tk.warn_left", lang, { left }) : t("tk.warn_limit", lang)
    }),
    mentions: [targetJid]
  });

  if (count >= MAX_WARNS) {
    try {
      await sock.groupParticipantsUpdate(jid, [targetJid], "remove");
      delete db.warns[key];
      saveDb();
    } catch (error) {
      await sock.sendMessage(jid, { text: t("tk.warn_kick_fail", lang) });
    }
  }

  return count;
}

async function handleAntilink(sock, msg) {
  const jid = msg?.key?.remoteJid;

  if (!jid || !jid.endsWith("@g.us") || msg.key.fromMe) return;

  const mode = db.antilink[jid];
  if (!mode || mode === "off") return;

  const text = textOf(msg);
  if (!text) return;

  const re = mode === "wa" ? LINK_WA : LINK_ALL;
  if (!re.test(text)) return;

  if (isOwnerMsg(msg)) return;

  const meta = await getMeta(sock, jid);
  const admins = adminSet(meta);

  if (senderIds(msg).some(i => admins.has(i))) return;

  // bot admin නැත්නම් delete / kick කරන්න බෑ
  if (!botIds(sock).some(i => admins.has(i))) return;

  try {
    await sock.sendMessage(jid, { delete: msg.key });
  } catch {}

  const target = msg.key.participant;
  if (target) {
    const lang = await langOf(msg);
    await addWarn(sock, jid, target, t("tk.reason_links", lang), lang);
  }
}

/* =====================================================
   COMMANDS
===================================================== */

const pick = arr => arr[Math.floor(Math.random() * arr.length)];

function fmtUptime() {
  let s = Math.floor(process.uptime());
  const d = Math.floor(s / 86400); s %= 86400;
  const h = Math.floor(s / 3600); s %= 3600;
  const m = Math.floor(s / 60); s %= 60;
  return `${d ? d + "d " : ""}${h}h ${m}m ${s}s`;
}

function safeCalc(expr) {
  const e = String(expr || "").replace(/\s+/g, "").replace(/×/g, "*").replace(/÷/g, "/").replace(/\^/g, "**");

  if (!e || e.length > 100) throw new Error("calc.invalid");
  if (!/^[0-9+\-*/%.()]+$/.test(e)) throw new Error("calc.chars");

  // eslint-disable-next-line no-new-func
  const value = Function(`"use strict"; return (${e});`)();

  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("calc.result");

  return value;
}

let broadcasting = false;
let stopBroadcast = false;

async function runBroadcast(sock, ownerJid, text, lang) {
  broadcasting = true;
  stopBroadcast = false;

  let ok = 0;
  let fail = 0;
  let total = 0;

  try {
    const groups = Object.keys(await sock.groupFetchAllParticipating());
    const list = groups.slice(0, BROADCAST_MAX);
    total = list.length;

    for (const gid of list) {
      if (stopBroadcast) break;

      try {
        await sock.sendMessage(gid, {
          text: `📢 *BROADCAST*\n\n${text}\n\n> ${BOT_NAME}`
        });
        ok++;
      } catch {
        fail++;
      }

      // spam ban වලින් බේරෙන්න 3–6s පරතරයක්
      await sleep(3000 + Math.floor(Math.random() * 3000));
    }
  } catch (error) {
    console.error("❌ [toolkit] broadcast error:", error?.message || error);
  }

  broadcasting = false;

  try {
    await sock.sendMessage(ownerJid, {
      text: t(stopBroadcast ? "tk.bc_stopped" : "tk.bc_done", lang, { ok, fail, total })
    });
  } catch {}
}

async function execute(sock, msg, args, commandName) {
  const jid = msg.key.remoteJid;
  const cmd = String(commandName || "").toLowerCase();
  const prefix = await getPrefix();
  const lang = await langOf(msg);
  const T = (key, vars) => t(key, lang, vars);
  const reply = text => sock.sendMessage(jid, { text }, { quoted: msg });

  try {
    switch (cmd) {
      /* ---------- INFO ---------- */
      case "toolkit":
        return reply(
          `${T("tk.title")}\n\n` +
            `${T("tk.h_mod")}\n` +
            `▫️ ${prefix}antilink on|off|wa\n▫️ ${prefix}warn @user [reason]\n▫️ ${prefix}warns [@user]\n▫️ ${prefix}resetwarn @user\n\n` +
            `${T("tk.h_owner")}\n` +
            `▫️ ${prefix}broadcast <text>\n▫️ ${prefix}broadcast stop\n\n` +
            `${T("tk.h_tools")}\n` +
            `▫️ ${prefix}calc <expr>\n▫️ ${prefix}ping\n▫️ ${prefix}stats\n▫️ ${prefix}sltime\n▫️ ${prefix}shorturl <link>\n\n` +
            `${T("tk.h_fun")}\n` +
            `▫️ ${prefix}coin  ▫️ ${prefix}dice [sides]\n▫️ ${prefix}choose a | b | c\n▫️ ${prefix}8ball <question>\n▫️ ${prefix}truth  ▫️ ${prefix}dare\n\n> ${BOT_NAME}`
        );

      /* ---------- MODERATION ---------- */
      case "antilink": {
        const meta = await requireGroupAdmin(sock, msg, reply, lang);
        if (!meta) return;

        const opt = String(args[0] || "").toLowerCase();

        if (!["on", "off", "wa", "all"].includes(opt)) {
          const cur = db.antilink[jid] || "off";
          return reply(
            `${T("tk.al_title", { cur })}\n\n` +
              `▫️ ${prefix}antilink on  — ${T("tk.al_on")}\n` +
              `▫️ ${prefix}antilink wa  — ${T("tk.al_wa")}\n` +
              `▫️ ${prefix}antilink off`
          );
        }

        db.antilink[jid] = opt === "on" ? "all" : opt;
        saveDb();

        const botAdmin = botIds(sock).some(i => adminSet(meta).has(i));

        return reply(
          T("tk.al_set", { mode: db.antilink[jid].toUpperCase() }) +
            (db.antilink[jid] !== "off" && !botAdmin ? `\n\n${T("tk.al_noadmin")}` : "")
        );
      }

      case "warn": {
        const meta = await requireGroupAdmin(sock, msg, reply, lang);
        if (!meta) return;

        const target = getTarget(msg, args);
        if (!target) return reply(T("tk.warn_usage", { p: prefix }));

        if (adminSet(meta).has(clean(target))) return reply(T("tk.warn_admin"));

        const reason =
          args.filter(a => !a.startsWith("@") && !/^\d{8,}$/.test(a)).join(" ") || T("tk.no_reason");

        await addWarn(sock, jid, target, reason, lang);
        return;
      }

      case "warns": {
        if (!jid.endsWith("@g.us")) return reply(T("common.group_only"));

        const target = getTarget(msg, args) || msg.key.participant;
        const count = db.warns[`${jid}|${clean(target)}`] || 0;

        return sock.sendMessage(
          jid,
          { text: T("tk.warns_of", { num: clean(target), c: count, max: MAX_WARNS }), mentions: [target] },
          { quoted: msg }
        );
      }

      case "resetwarn": {
        const meta = await requireGroupAdmin(sock, msg, reply, lang);
        if (!meta) return;

        const target = getTarget(msg, args);
        if (!target) return reply(T("tk.resetwarn_usage", { p: prefix }));

        delete db.warns[`${jid}|${clean(target)}`];
        saveDb();

        return reply(T("tk.resetwarn_ok", { num: clean(target) }));
      }

      /* ---------- OWNER ---------- */
      case "broadcast": {
        if (!isOwnerMsg(msg)) return reply(T("common.owner_only"));

        if (String(args[0] || "").toLowerCase() === "stop") {
          stopBroadcast = true;
          return reply(T("tk.bc_stopping"));
        }

        const text = args.join(" ").trim();
        if (!text) return reply(T("tk.bc_usage", { p: prefix, max: BROADCAST_MAX }));
        if (broadcasting) return reply(T("tk.bc_running"));

        await reply(T("tk.bc_started"));

        // background — handler එක block නොකර
        runBroadcast(sock, jid, text, lang).catch(() => {});
        return;
      }

      /* ---------- TOOLS ---------- */
      case "calc": {
        if (!args.length) return reply(T("tk.calc_usage", { p: prefix }));

        try {
          const value = safeCalc(args.join(" "));
          return reply(`🧮 ${args.join(" ")} = *${Number.isInteger(value) ? value : +value.toFixed(8)}*`);
        } catch (error) {
          const m = String(error.message || "");
          return reply(`❌ ${m.startsWith("calc.") ? T(m) : m}`);
        }
      }

      case "ping": {
        const t0 = Date.now();
        const sent = await reply(T("tk.pinging"));
        const ms = Date.now() - t0;
        const text = T("tk.pong", { ms });

        try {
          return await sock.sendMessage(jid, { text, edit: sent.key });
        } catch {
          return reply(text);
        }
      }

      case "stats": {
        let groups = "n/a";

        try {
          groups = Object.keys(await sock.groupFetchAllParticipating()).length;
        } catch {}

        const mem = (process.memoryUsage().rss / 1024 / 1024).toFixed(1);

        return reply(
          T("tk.stats", { bot: BOT_NAME, up: fmtUptime(), mem, groups, node: process.version })
        );
      }

      case "sltime": {
        const now = new Date();
        // සිංහල locale එකේ මාස නම් server එකෙන් server එකට වෙනස් නිසා දිනය හැම විටම English format එකෙන්
        const d = new Intl.DateTimeFormat("en-GB", {
          timeZone: "Asia/Colombo",
          dateStyle: "full",
          timeStyle: "medium"
        }).format(now);

        return reply(T("tk.sltime", { d }));
      }

      case "shorturl": {
        const url = args[0];
        if (!url || !/^https?:\/\//i.test(url)) return reply(T("tk.short_usage", { p: prefix }));

        try {
          const res = await fetch(`https://is.gd/create.php?format=simple&url=${encodeURIComponent(url)}`, {
            signal: AbortSignal.timeout(10000)
          });
          const out = (await res.text()).trim();

          if (!out.startsWith("http")) throw new Error(out || "Failed");

          return reply(`🔗 ${out}`);
        } catch (error) {
          return reply(T("tk.short_fail", { msg: error.message }));
        }
      }

      /* ---------- FUN ---------- */
      case "coin":
        return reply(`🪙 *${T(Math.random() < 0.5 ? "tk.heads" : "tk.tails")}*`);

      case "dice": {
        const sides = Math.min(Math.max(parseInt(args[0], 10) || 6, 2), 1000);
        return reply(`🎲 d${sides}: *${1 + Math.floor(Math.random() * sides)}*`);
      }

      case "choose": {
        const options = args.join(" ").split("|").map(x => x.trim()).filter(Boolean);
        if (options.length < 2) return reply(T("tk.choose_usage", { p: prefix }));
        return reply(T("tk.choose_res", { x: pick(options) }));
      }

      case "8ball":
        if (!args.length) return reply(T("tk.ball_usage", { p: prefix }));
        return reply(`🎱 ${pick(ta("tk.ball", lang))}`);

      case "truth":
        return reply(`${T("tk.truth_h")}\n\n${pick(ta("tk.truths", lang))}`);

      case "dare":
        return reply(`${T("tk.dare_h")}\n\n${pick(ta("tk.dares", lang))}`);

      default:
        return;
    }
  } catch (error) {
    console.error(`❌ [toolkit:${cmd}]`, error?.stack || error?.message || error);

    try {
      await reply(T("common.error", { msg: error?.message || error }));
    } catch {}
  }
}

/* =====================================================
   PLUGIN EXPORT
   (පළමු command එක "toolkit" — pluginoff toolkit කළොත් මුළු එකම off)
===================================================== */

export default {
  name: "toolkit",

  command: [
    "toolkit",
    "antilink", "warn", "warns", "resetwarn",
    "broadcast",
    "calc", "ping", "stats", "sltime", "shorturl",
    "coin", "dice", "choose", "8ball", "truth", "dare"
  ],

  execute,

  // හැම message එකකටම index.js එකෙන් call වෙනවා (antilink)
  async handleMessage(sock, msg) {
    try {
      await handleAntilink(sock, msg);
    } catch (error) {
      console.error("❌ [toolkit] antilink error:", error?.message || error);
    }
  }
};
