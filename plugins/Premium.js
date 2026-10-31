// plugins/premiumbot.js
// SHAN MINI BOT V1 — Per-bot Premium (grant / extend / remove / check + gate)
//
// RULES
//  • Premium is tied to the bot that granted it. A user given Premium on the
//    main bot can't use it on a sub-bot (and the other way round).
//  • Only the OWNER and BOT ADMINS can add / extend / remove Premium.
//    Normal users can't, on any bot.
//  • Premium-only commands are chosen with .premiumco / .unpremiumco (premiumco.js).
//
// COMMANDS (owner / admin)
//  .addpremium <number> <30d> <reason>     .extendpremium <number> <30d> <reason>
//  .delpremium <number>                    .premiuminfo <number>
//  .premiumlist  (this bot)                .premiumlist all  (owner: every bot)
// COMMAND (everyone)
//  .mypremium → my Premium status on this bot
//
// This plugin REPLACES plugins/premium.js. Also remove the 6 premium commands
// from COMMANDS in botadmin.js (premiumlist, plist, addpremium, delpremium,
// premiuminfo, extendpremium) so they are not registered twice.
//
// index.js (patched) enforces Premium itself with the same per-bot rule.
// SHAN_PREMIUM_GATE / SHAN_IS_PREMIUM below are optional helpers for other plugins.

import mongoose from "mongoose";

const OWNER_NUMBER = (process.env.OWNER_NUMBER || "94752661225").replace(/\D/g, "");

const USERS = "premiumusers";
const SETTINGS = "premiumsettings";
const SETTINGS_ID = "premium_commands";

// Bot admins can use Premium commands without having Premium themselves
const ADMINS_BYPASS = true;

export const commands = [
  "premiumlist",
  "plist",
  "addpremium",
  "delpremium",
  "premiuminfo",
  "extendpremium",
  "mypremium"
];

export const aliases = ["plist"];

// Never locked behind Premium
const NEVER_GATED = new Set([
  ...commands,
  "premiumco", "unpremiumco", "premiumcolist", "premiumonly"
]);

const DENIED = "🚫 Only the owner and bot admins can manage Premium.";

/* =====================================================
HELPERS
===================================================== */

function collection(name) {
  if (mongoose.connection.readyState !== 1 || !mongoose.connection.db) {
    throw new Error("MongoDB is not connected.");
  }
  return mongoose.connection.db.collection(name);
}

function cleanNumber(value = "") {
  return String(value).split("@")[0].split(":")[0].replace(/\D/g, "");
}

function chatJid(number) {
  return `${cleanNumber(number)}@s.whatsapp.net`;
}

function senderNumber(msg) {
  return cleanNumber(
    globalThis.SHAN_GET_SENDER?.(msg) ||
      msg?.key?.participant ||
      msg?.key?.remoteJid ||
      ""
  );
}

const reply = (sock, msg, text) =>
  sock.sendMessage(msg.key.remoteJid, { text }, { quoted: msg });

async function getPrefix() {
  try {
    const s = await globalThis.SHAN_GET_SETTINGS?.();
    if (s?.prefix) return s.prefix;
  } catch {}
  return process.env.PREFIX || ".";
}

function dateText(value) {
  if (!value) return "Unknown";

  return new Date(value).toLocaleString("en-GB", {
    timeZone: "Asia/Colombo",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function parseDuration(duration) {
  const match = String(duration || "").trim().match(/^(\d+)(d|w|m|y)$/i);
  if (!match) return null;

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();

  if (!Number.isSafeInteger(amount) || amount < 1 || amount > 1000) return null;

  const date = new Date();

  if (unit === "d") date.setDate(date.getDate() + amount);
  else if (unit === "w") date.setDate(date.getDate() + amount * 7);
  else if (unit === "m") date.setMonth(date.getMonth() + amount);
  else date.setFullYear(date.getFullYear() + amount);

  return date;
}

function durationLabel(duration) {
  const match = String(duration || "").match(/^(\d+)(d|w|m|y)$/i);
  if (!match) return String(duration || "Unknown");

  const amount = Number(match[1]);
  const units = {
    d: amount === 1 ? "Day" : "Days",
    w: amount === 1 ? "Week" : "Weeks",
    m: amount === 1 ? "Month" : "Months",
    y: amount === 1 ? "Year" : "Years"
  };

  return `${amount} ${units[match[2].toLowerCase()]}`;
}

/* =====================================================
BOT SCOPE
"main" = the main bot, otherwise the sub-bot's number.
Old records without a botId belong to the main bot.
===================================================== */

function botIdOf(sock, msg) {
  const flag = msg?.__shanSub;

  if (!flag) return "main";

  const raw =
    typeof flag === "string" || typeof flag === "number"
      ? flag
      : flag?.number || sock?.botNumber || sock?.user?.id || "";

  return cleanNumber(raw) || "sub";
}

const botLabel = botId => (botId === "main" ? "Main bot" : `Sub-bot +${botId}`);

const scopeOf = botId =>
  botId === "main"
    ? { $or: [{ botId: "main" }, { botId: { $exists: false } }, { botId: null }] }
    : { botId };

const recordBot = record => record?.botId || "main";

const isActive = record =>
  Boolean(record) && new Date(record.expiresAt).getTime() > Date.now();

// Bot numbers where this user has ACTIVE Premium (optionally excluding one bot)
async function activePremiumBots(number, exceptBotId = null) {
  const rows = await collection(USERS)
    .find({ number, expiresAt: { $gt: new Date() } })
    .toArray();

  return [
    ...new Set(
      rows
        .filter(r => recordBot(r) !== exceptBotId)
        .map(r => cleanNumber(r.botNumber) || (recordBot(r) === "main" ? OWNER_NUMBER : recordBot(r)))
    )
  ];
}

function findPremium(number, botId) {
  return collection(USERS).findOne(
    { number, ...scopeOf(botId) },
    { sort: { expiresAt: -1 } }
  );
}

/* =====================================================
ROLES
===================================================== */

// Owner only. On a sub-bot "fromMe" is a normal user, so only the exact owner number counts there.
function isOwner(msg) {
  if (senderNumber(msg) === OWNER_NUMBER) return true;
  if (!msg?.__shanSub) return Boolean(globalThis.SHAN_IS_OWNER_MSG?.(msg));
  return false;
}

async function isAdmin(msg) {
  try {
    return typeof globalThis.SHAN_IS_ADMIN === "function"
      ? Boolean(await globalThis.SHAN_IS_ADMIN(senderNumber(msg)))
      : false;
  } catch {
    return false;
  }
}

async function isStaff(msg) {
  return isOwner(msg) || (await isAdmin(msg));
}

// Same audit log that .adminlogs shows (botadminlogs). Never breaks the command.
async function logAction(msg, action, targetNumber, details = {}) {
  try {
    const number = senderNumber(msg);
    let adminId = "OWNER";
    let name = String(msg?.pushName || "Unknown").slice(0, 100);

    if (!isOwner(msg)) {
      const admin = await collection("botadmins").findOne({ number, active: true });

      adminId = admin?.adminId || "UNKNOWN";
      name = admin?.name || name;
    }

    await collection("botadminlogs").insertOne({
      actorNumber: number,
      actorName: name,
      actorAdminId: adminId,
      action,
      targetNumber: cleanNumber(targetNumber),
      details,
      createdAt: new Date()
    });
  } catch (error) {
    console.error("[PREMIUM] Audit log failed:", error.message);
  }
}

// Can this sender use Premium commands on THIS bot?
async function hasAccess(sock, msg) {
  if (isOwner(msg)) return true;
  if (ADMINS_BYPASS && (await isAdmin(msg))) return true;

  const number = senderNumber(msg);
  if (!number) return false;

  return isActive(await findPremium(number, botIdOf(sock, msg)));
}

/* =====================================================
GATE — called by index.js before every command
===================================================== */

async function getPremiumCommands() {
  const doc = await collection(SETTINGS).findOne({ _id: SETTINGS_ID });
  return new Set((doc?.commands || []).map(c => String(c).toLowerCase()));
}

globalThis.SHAN_IS_PREMIUM = (sock, msg) => hasAccess(sock, msg);

globalThis.SHAN_PREMIUM_GATE = async (sock, msg, commandName, forcePremium = false) => {
  const cmd = String(commandName || "").replace(/^[.!#/$]+/, "").toLowerCase();

  if (!cmd || NEVER_GATED.has(cmd)) return { allowed: true };

  let needsPremium = forcePremium === true;

  try {
    if (!needsPremium) needsPremium = (await getPremiumCommands()).has(cmd);
  } catch (error) {
    console.error("[PREMIUM GATE] list error:", error.message);
  }

  if (!needsPremium) return { allowed: true };

  try {
    if (await hasAccess(sock, msg)) return { allowed: true };

    const prefix = await getPrefix();
    const botId = botIdOf(sock, msg);
    const number = senderNumber(msg);

    // Where (if anywhere) does this user have Premium?
    const bots = number ? await activePremiumBots(number, botId) : [];

    return {
      allowed: false,
      text: bots.length
        ? `💎 *PREMIUM ONLY*\n\nYour Premium doesn't work on this bot.\n\n✅ Your Premium is active only on:\n${bots.map(n => `• +${n}`).join("\n")}\n\nPlease use that bot to use your Premium.`
        : `💎 *PREMIUM ONLY*\n\nThis command is for Premium users only.\n\nYou don't have Premium yet. Contact the owner or a bot admin to get it.\n📞 ${prefix}owner`
    };
  } catch (error) {
    console.error("[PREMIUM GATE] error:", error.message);
    return { allowed: false, text: "⚠️ Could not verify Premium right now. Please try again." };
  }
};

/* =====================================================
NOTICES
===================================================== */

function premiumNotice(number, duration, expiresAt, reason, botId) {
  return `
👑 *SHAN MINI BOT — PREMIUM ACTIVATED* 💙

🎉 Your Premium membership has been activated successfully!

📱 *Number:* ${number}
💎 *Plan:* PREMIUM
🤖 *Valid on:* ${botLabel(botId)} only
⏳ *Duration:* ${durationLabel(duration)}
📅 *Expires On:* ${dateText(expiresAt)}

━━━━━━━━━━━━━━━━━━

💰 *WHY IS PREMIUM PAID?*

Premium payments help us cover the costs of purchasing and maintaining a VPS (Virtual Private Server) to keep SHAN MINI BOT running smoothly, 24/7.

🖥️ *YOUR SUPPORT HELPS WITH:*

✅ VPS server costs
✅ Keeping the bot online 24/7
✅ Server maintenance
✅ Future bot improvements
✅ Better performance and stability

📌 *PREMIUM REASON:*
${reason}

━━━━━━━━━━━━━━━━━━

🙏 Thank you for supporting SHAN MINI BOT!

⚡ *POWERED BY SHAN MINI BOT* 💙
`.trim();
}

/* =====================================================
ADD / EXTEND
===================================================== */

async function grant(sock, msg, args, extend) {
  if (!(await isStaff(msg))) return reply(sock, msg, DENIED);

  const prefix = await getPrefix();
  const name = extend ? "extendpremium" : "addpremium";

  const number = cleanNumber(args[0]);
  const duration = args[1];
  const reason = args.slice(2).join(" ").trim() || "Premium access granted by the bot team.";

  if (!number || !duration) {
    return reply(
      sock,
      msg,
      `❌ Usage:\n${prefix}${name} <number> <duration> <reason>\n\nExample:\n${prefix}${name} 94712345678 30d Paid Premium\n\nDuration: 7d · 1w · 1m · 3m · 1y`
    );
  }

  if (number.startsWith("0")) {
    return reply(sock, msg, "❌ Use the country code, without + or 0.\nExample: 94712345678");
  }

  if (number.length < 8 || number.length > 15) {
    return reply(sock, msg, "❌ Invalid WhatsApp number.");
  }

  if (number === OWNER_NUMBER) {
    return reply(sock, msg, "❌ The owner doesn't need Premium.");
  }

  const added = parseDuration(duration);

  if (!added) {
    return reply(sock, msg, "❌ Invalid duration. Use 7d, 30d, 1w, 1m, 3m or 1y.");
  }

  const botId = botIdOf(sock, msg);
  const users = collection(USERS);
  const existing = await findPremium(number, botId);
  const now = new Date();

  let expiresAt = added;

  if (extend && isActive(existing)) {
    expiresAt = new Date(
      new Date(existing.expiresAt).getTime() + (added.getTime() - now.getTime())
    );
  }

  const record = {
    number,
    botId,
    botNumber: cleanNumber(sock?.user?.id),
    grantedAt: existing?.grantedAt || now,
    updatedAt: now,
    expiresAt,
    reason,
    duration,
    addedBy: senderNumber(msg) || OWNER_NUMBER,
    expirationNotified: false
  };

  if (existing) {
    await users.updateOne({ _id: existing._id }, { $set: record });
  } else {
    await users.insertOne(record);
  }

  await logAction(msg, extend ? "PREMIUM_EXTENDED" : "PREMIUM_GRANTED", number, {
    bot: botLabel(botId),
    duration,
    reason,
    expiresAt
  });

  // Sent from THIS bot, so the user sees which bot their Premium belongs to
  let notified = false;

  try {
    await sock.sendMessage(chatJid(number), {
      text: premiumNotice(number, duration, expiresAt, reason, botId)
    });
    notified = true;
  } catch (error) {
    console.error("[PREMIUM] Notification failed:", error.message);
  }

  return reply(
    sock,
    msg,
    `✅ *PREMIUM ${extend ? "EXTENDED" : "ACTIVATED"}*\n\n` +
      `📱 Number: ${number}\n` +
      `🤖 Valid on: ${botLabel(botId)} only\n` +
      `⏳ Duration: ${durationLabel(duration)}\n` +
      `📅 Expires: ${dateText(expiresAt)}\n` +
      `📌 Reason: ${reason}\n\n` +
      `📩 User notification: ${notified ? "Sent" : "Could not be delivered"}`
  );
}

/* =====================================================
REMOVE
===================================================== */

async function revoke(sock, msg, args) {
  if (!(await isStaff(msg))) return reply(sock, msg, DENIED);

  const prefix = await getPrefix();
  const number = cleanNumber(args[0]);

  if (!number) return reply(sock, msg, `❌ Usage: ${prefix}delpremium <number>`);

  const botId = botIdOf(sock, msg);
  const users = collection(USERS);
  const user = await findPremium(number, botId);

  if (!user) {
    const elsewhere = await users.countDocuments({ number });

    return reply(
      sock,
      msg,
      elsewhere
        ? `❌ ${number} has no Premium on this bot.\n\nThey have Premium on another bot — run ${prefix}delpremium on that bot to remove it.`
        : `❌ No Premium record found for ${number}.`
    );
  }

  await users.deleteOne({ _id: user._id });

  try {
    await sock.sendMessage(chatJid(number), {
      text:
        `⚠️ *SHAN MINI BOT — PREMIUM REMOVED*\n\n` +
        `Your Premium membership on ${botLabel(botId)} has been removed.\n\n` +
        `If you have questions, please contact the bot owner.\n\n⚡ SHAN MINI BOT`
    });
  } catch (error) {
    console.error("[PREMIUM] Removal notification failed:", error.message);
  }

  return reply(sock, msg, `✅ Premium removed.\n\n📱 Number: ${number}\n🤖 Bot: ${botLabel(botId)}`);
}

/* =====================================================
INFO / LIST / MY STATUS
===================================================== */

async function info(sock, msg, args) {
  if (!(await isStaff(msg))) return reply(sock, msg, DENIED);

  const prefix = await getPrefix();
  const number = cleanNumber(args[0]);

  if (!number) return reply(sock, msg, `❌ Usage: ${prefix}premiuminfo <number>`);

  const botId = botIdOf(sock, msg);
  const user = await findPremium(number, botId);

  if (!user) {
    return reply(sock, msg, `❌ No Premium record found for ${number} on this bot.`);
  }

  return reply(
    sock,
    msg,
    `💎 *PREMIUM USER DETAILS*\n\n` +
      `📱 Number: ${user.number}\n` +
      `🤖 Bot: ${botLabel(botId)}\n` +
      `📊 Status: ${isActive(user) ? "ACTIVE" : "EXPIRED"}\n` +
      `📅 Granted: ${dateText(user.grantedAt)}\n` +
      `⏳ Expires: ${dateText(user.expiresAt)}\n` +
      `📌 Reason: ${user.reason || "Not specified"}\n` +
      `👤 Granted by: ${user.addedBy || OWNER_NUMBER}`
  );
}

async function list(sock, msg, args) {
  if (!(await isStaff(msg))) return reply(sock, msg, DENIED);

  const all = String(args[0] || "").toLowerCase() === "all";

  if (all && !isOwner(msg)) {
    return reply(sock, msg, "🚫 Only the owner can view every bot's Premium users.");
  }

  const botId = botIdOf(sock, msg);

  const rows = await collection(USERS)
    .find(all ? {} : scopeOf(botId))
    .sort({ expiresAt: -1 })
    .limit(100)
    .toArray();

  if (!rows.length) return reply(sock, msg, "📭 No Premium users found.");

  const lines = rows.map(
    (u, i) =>
      `${i + 1}. ${u.number}${all ? `  (${botLabel(recordBot(u))})` : ""}\n` +
      `   ${isActive(u) ? "ACTIVE" : "EXPIRED"} • ${dateText(u.expiresAt)}`
  );

  return reply(
    sock,
    msg,
    `💎 *PREMIUM USERS — ${all ? "ALL BOTS" : botLabel(botId).toUpperCase()}*\n\n${lines.join("\n\n")}\n\nTotal: ${rows.length}`
  );
}

async function myPremium(sock, msg) {
  if (isOwner(msg)) return reply(sock, msg, "👑 You are the owner — every command is open to you.");

  if (ADMINS_BYPASS && (await isAdmin(msg))) {
    return reply(sock, msg, "🛡️ You are a bot admin — Premium commands are open to you.");
  }

  const number = senderNumber(msg);
  const botId = botIdOf(sock, msg);
  const user = number ? await findPremium(number, botId) : null;

  if (isActive(user)) {
    return reply(
      sock,
      msg,
      `💎 *YOUR PREMIUM*\n\n🤖 Bot: ${botLabel(botId)}\n📊 Status: ACTIVE\n⏳ Expires: ${dateText(user.expiresAt)}`
    );
  }

  if (user) {
    return reply(sock, msg, `⌛ Your Premium on this bot expired on ${dateText(user.expiresAt)}.`);
  }

  const bots = number ? await activePremiumBots(number, botId) : [];

  if (bots.length) {
    return reply(
      sock,
      msg,
      `🆓 You don't have Premium on this bot.\n\n✅ Your Premium is active only on:\n${bots.map(n => `• +${n}`).join("\n")}`
    );
  }

  return reply(sock, msg, "🆓 You don't have Premium yet. Contact the owner or a bot admin to get it.");
}

/* =====================================================
EXECUTE
===================================================== */

export async function execute(sock, msg, args = [], commandName = "") {
  if (!msg?.key?.remoteJid) return;

  const command = String(commandName || "").replace(/^[.!#/$]+/, "").toLowerCase();

  try {
    if (command === "addpremium") return await grant(sock, msg, args, false);
    if (command === "extendpremium") return await grant(sock, msg, args, true);
    if (command === "delpremium") return await revoke(sock, msg, args);
    if (command === "premiuminfo") return await info(sock, msg, args);
    if (command === "premiumlist" || command === "plist") return await list(sock, msg, args);
    if (command === "mypremium") return await myPremium(sock, msg);

    return await reply(sock, msg, "❌ Unknown command.");
  } catch (error) {
    console.error("[PREMIUMBOT ERROR]", error?.stack || error?.message || error);
    return reply(sock, msg, `❌ Command failed.\n\n${error?.message || "Unknown error"}`);
  }
}

/* =====================================================
OPTIONAL — expiry notices (call from index.js startup, like before)
Each notice is sent by the bot the Premium belongs to.
===================================================== */

export async function checkPremiumExpirations(mainSock) {
  try {
    const users = collection(USERS);

    const expired = await users
      .find({ expiresAt: { $lte: new Date() }, expirationNotified: { $ne: true } })
      .toArray();

    for (const user of expired) {
      const botId = recordBot(user);
      const botSock =
        botId === "main" ? mainSock : globalThis.__shanSubBots?.get(botId)?.sock;

      if (!botSock) continue;

      try {
        await botSock.sendMessage(chatJid(user.number), {
          text:
            `⚠️ *SHAN MINI BOT — PREMIUM EXPIRED*\n\n` +
            `Your Premium membership on ${botLabel(botId)} has expired.\n\n` +
            `To continue enjoying Premium features, please contact the bot owner.\n\n` +
            `Thank you for supporting SHAN MINI BOT. 💙`
        });

        await users.updateOne(
          { _id: user._id },
          { $set: { expirationNotified: true, expirationNotifiedAt: new Date() } }
        );
      } catch (error) {
        console.error("[PREMIUM] Expiration notice failed:", error.message);
      }
    }
  } catch (error) {
    console.error("[PREMIUM] Expiration checker error:", error.message);
  }
}

export default { commands, aliases, execute, checkPremiumExpirations };
