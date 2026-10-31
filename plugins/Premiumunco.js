// plugins/premiumco.js
// SHAN MINI BOT V1 — Premium-only command control (OWNER only)
//
//   .premiumco alive          → "alive" works for Premium users only
//   .premiumco alive botinfo  → several commands at once
//   .unpremiumco alive        → "alive" works for everyone again
//   .premiumcolist            → list of Premium-only commands (anyone can view)
//
// Uses the same list as .premiumonly (premiumsettings / premium_commands),
// so premiumbot.js (the gate) and the menu's 💎 marks see it automatically.
// Install: ./plugins/premiumco.js

import mongoose from "mongoose";

const OWNER_NUMBER = (process.env.OWNER_NUMBER || "94752661225").replace(/\D/g, "");

const SETTINGS_COLLECTION = "premiumsettings";
const SETTINGS_ID = "premium_commands";

// These must always stay free, otherwise nobody could manage Premium
const PROTECTED = new Set([
  "premiumco", "unpremiumco", "premiumcolist", "premiumonly",
  "addpremium", "delpremium", "extendpremium", "premiuminfo",
  "premiumlist", "plist", "mypremium", "menu"
]);

const VALID_NAME = /^[a-z0-9_-]{1,30}$/;

export const commands = ["premiumco", "unpremiumco", "premiumcolist"];

/* =====================================================
HELPERS
===================================================== */

function collection() {
  if (mongoose.connection.readyState !== 1 || !mongoose.connection.db) {
    throw new Error("MongoDB is not connected.");
  }
  return mongoose.connection.db.collection(SETTINGS_COLLECTION);
}

function cleanNumber(value = "") {
  return String(value).split("@")[0].split(":")[0].replace(/\D/g, "");
}

function senderNumber(msg) {
  return cleanNumber(
    globalThis.SHAN_GET_SENDER?.(msg) ||
      msg?.key?.participant ||
      msg?.key?.remoteJid ||
      ""
  );
}

// Owner only. On a sub-bot "fromMe" is a normal user, so only the exact owner number counts there.
function isOwner(msg) {
  if (senderNumber(msg) === OWNER_NUMBER) return true;
  if (!msg?.__shanSub) return Boolean(globalThis.SHAN_IS_OWNER_MSG?.(msg));
  return false;
}

async function getPrefix() {
  try {
    const s = await globalThis.SHAN_GET_SETTINGS?.();
    if (s?.prefix) return s.prefix;
  } catch {}
  return process.env.PREFIX || ".";
}

const normalize = value =>
  String(value || "").trim().replace(/^[.!#/$]+/, "").toLowerCase();

/* =====================================================
EXECUTE
===================================================== */

export async function execute(sock, msg, args = [], commandName = "") {
  const jid = msg.key.remoteJid;
  const reply = text => sock.sendMessage(jid, { text }, { quoted: msg });
  const cmd = normalize(commandName);
  const prefix = await getPrefix();

  try {
    const settings = collection();
    const doc = await settings.findOne({ _id: SETTINGS_ID });
    const current = new Set(doc?.commands || []);

    /* ---------- LIST (everyone) ---------- */
    if (cmd === "premiumcolist" || (cmd === "premiumco" && normalize(args[0]) === "list")) {
      const list = [...current];

      return reply(
        `💎 *PREMIUM-ONLY COMMANDS* (${list.length})\n\n` +
          (list.length ? list.map((c, i) => `${i + 1}. ${prefix}${c}`).join("\n") : "None set yet.") +
          `\n\nAdd: ${prefix}premiumco <command>\nRemove: ${prefix}unpremiumco <command>`
      );
    }

    /* ---------- OWNER ONLY ---------- */
    if (!isOwner(msg)) {
      return reply("🚫 Only the bot owner can change Premium-only commands.");
    }

    const names = [...new Set(args.map(normalize).filter(Boolean))];

    if (!names.length) {
      return reply(
        `💎 *PREMIUM COMMAND CONTROL*\n\n` +
          `${prefix}premiumco alive\n→ only Premium users can use it\n\n` +
          `${prefix}unpremiumco alive\n→ everyone can use it again\n\n` +
          `${prefix}premiumcolist\n→ show Premium-only commands\n\n` +
          `ℹ️ Aliases count separately, so add each name (e.g. play and play2).`
      );
    }

    const invalid = names.filter(n => !VALID_NAME.test(n));
    const valid = names.filter(n => VALID_NAME.test(n));
    const lines = [];

    /* ---------- .premiumco ---------- */
    if (cmd === "premiumco") {
      const blocked = valid.filter(n => PROTECTED.has(n));
      const already = valid.filter(n => !PROTECTED.has(n) && current.has(n));
      const toAdd = valid.filter(n => !PROTECTED.has(n) && !current.has(n));

      if (toAdd.length) {
        await settings.updateOne(
          { _id: SETTINGS_ID },
          { $addToSet: { commands: { $each: toAdd } } },
          { upsert: true }
        );
        globalThis.SHAN_CLEAR_PREMIUM_CACHE?.();
        lines.push(`✅ Premium-only now: ${toAdd.map(c => prefix + c).join(", ")}`);
      }

      if (already.length) lines.push(`ℹ️ Already Premium-only: ${already.map(c => prefix + c).join(", ")}`);
      if (blocked.length) lines.push(`⛔ Can't be locked: ${blocked.map(c => prefix + c).join(", ")}`);
      if (invalid.length) lines.push(`❌ Invalid name: ${invalid.join(", ")}`);

      return reply(lines.join("\n") || "❌ Nothing to change.");
    }

    /* ---------- .unpremiumco ---------- */
    if (cmd === "unpremiumco") {
      const toRemove = valid.filter(n => current.has(n));
      const notSet = valid.filter(n => !current.has(n));

      if (toRemove.length) {
        await settings.updateOne(
          { _id: SETTINGS_ID },
          { $pull: { commands: { $in: toRemove } } }
        );
        globalThis.SHAN_CLEAR_PREMIUM_CACHE?.();
        lines.push(`✅ Open to everyone now: ${toRemove.map(c => prefix + c).join(", ")}`);
      }

      if (notSet.length) lines.push(`ℹ️ Wasn't Premium-only: ${notSet.map(c => prefix + c).join(", ")}`);
      if (invalid.length) lines.push(`❌ Invalid name: ${invalid.join(", ")}`);

      return reply(lines.join("\n") || "❌ Nothing to change.");
    }
  } catch (error) {
    console.error("[PREMIUMCO ERROR]", error?.stack || error?.message || error);
    return reply(`❌ Failed.\n\n${error?.message || "Unknown error"}`);
  }
}

export default { commands, execute };
