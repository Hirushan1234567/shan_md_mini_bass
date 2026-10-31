// plugins/botadmin.js
// SHAN MINI BOT V1
// BOT ADMIN + BLOCK/UNBLOCK + AUDIT LOGS
// Node.js ESM + Baileys + MongoDB
//
// Premium commands (addpremium, delpremium, extendpremium, premiuminfo, premiumlist)
// now live in premiumbot.js (per-bot Premium). They write to the same audit log.

import mongoose from "mongoose";

const OWNER_NUMBER = "94752661225";

const ADMIN_COLLECTION = "botadmins";
const LOG_COLLECTION = "botadminlogs";
const COUNTER_COLLECTION = "botadmincounters";
const SETTINGS_COLLECTION = "botsettings";

const COMMANDS = [
    "botadmin",
    "admininfo",
    "adminlogs",
    "adminblock",
    "adminunblock"
];

// -----------------------------------------------------
// HELPERS
// -----------------------------------------------------

function db() {
    if (mongoose.connection.readyState !== 1) {
        throw new Error("MongoDB is not connected.");
    }

    return mongoose.connection.db;
}

function cleanNumber(value = "") {
    return String(value)
        .replace(/@s\.whatsapp\.net/gi, "")
        .replace(/@c\.us/gi, "")
        .replace(/@lid/gi, "")
        .split(":")[0]
        .split("@")[0]
        .replace(/\D/g, "");
}

function senderNumber(msg) {
    const key = msg?.key || {};

    if (key.fromMe) {
        // On a sub-bot, "fromMe" is the sub-bot's own number — NOT the main owner
        return msg?.__shanSub ? cleanNumber(msg.__shanSub) : OWNER_NUMBER;
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
        const number = cleanNumber(value);

        if (number.length >= 8) {
            return number;
        }
    }

    return "";
}

function chatJid(number) {
    return `${cleanNumber(number)}@s.whatsapp.net`;
}

function isOwnerNumber(number) {
    return cleanNumber(number) === OWNER_NUMBER;
}

function isOwner(msg) {
    return isOwnerNumber(senderNumber(msg));
}

function displayName(msg) {
    return String(msg?.pushName || "Unknown User").trim().slice(0, 100);
}

function dateText(value) {
    if (!value) return "Unknown";

    return new Date(value).toLocaleString("en-GB", {
        timeZone: "Asia/Colombo",
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
    });
}

async function reply(sock, msg, text) {
    return sock.sendMessage(
        msg.key.remoteJid,
        { text },
        { quoted: msg }
    );
}

// -----------------------------------------------------
// ADMIN LOOKUP
// -----------------------------------------------------

async function findAdmin(number) {
    return db()
        .collection(ADMIN_COLLECTION)
        .findOne({
            number: cleanNumber(number),
            active: true
        });
}

async function isAdminNumber(number) {
    if (isOwnerNumber(number)) return true;

    return Boolean(await findAdmin(number));
}

async function isAuthorized(number) {
    if (isOwnerNumber(number)) return true;

    return Boolean(await findAdmin(number));
}

// Make the role checker available to index.js and other plugins.
globalThis.SHAN_IS_ADMIN = async number => {
    if (isOwnerNumber(number)) return true;

    try {
        return Boolean(await findAdmin(number));
    } catch {
        return false;
    }
};

// -----------------------------------------------------
// AUDIT LOGS
// -----------------------------------------------------

async function writeLog({
    actorNumber,
    actorName,
    actorAdminId = "OWNER",
    action,
    targetNumber = "",
    details = {}
}) {
    await db().collection(LOG_COLLECTION).insertOne({
        actorNumber: cleanNumber(actorNumber),
        actorName: String(actorName || "Unknown").slice(0, 100),
        actorAdminId,
        action,
        targetNumber: cleanNumber(targetNumber),
        details,
        createdAt: new Date()
    });
}

async function logActor(msg) {
    const number = senderNumber(msg);

    if (isOwnerNumber(number)) {
        return {
            number,
            name: displayName(msg),
            adminId: "OWNER"
        };
    }

    const admin = await findAdmin(number);

    if (!admin) {
        throw new Error("You are not an authorized bot admin.");
    }

    return {
        number,
        name: admin.name || displayName(msg),
        adminId: admin.adminId
    };
}

// -----------------------------------------------------
// ADMIN ID GENERATOR
// -----------------------------------------------------

async function generateAdminId() {
    const result = await db()
        .collection(COUNTER_COLLECTION)
        .findOneAndUpdate(
            { _id: "admin_id" },
            { $inc: { value: 1 } },
            {
                upsert: true,
                returnDocument: "after"
            }
        );

    // Compatibility with MongoDB driver versions.
    const counter = result?.value || result;
    const value = Number(counter?.value || 1);

    return `SHAN-ADM-${String(value).padStart(4, "0")}`;
}

// -----------------------------------------------------
// ADD ADMIN
// -----------------------------------------------------

async function addAdmin(sock, msg, args) {
    if (!isOwner(msg)) {
        return reply(
            sock,
            msg,
            "❌ Only the main owner can appoint bot admins."
        );
    }

    const number = cleanNumber(args[1]);

    if (!number || number.length < 8 || number.length > 15) {
        return reply(
            sock,
            msg,
            "❌ Usage:\n.botadmin add <number>\n\nExample:\n.botadmin add 94712345678"
        );
    }

    if (isOwnerNumber(number)) {
        return reply(sock, msg, "❌ The owner cannot be appointed as an admin.");
    }

    const admins = db().collection(ADMIN_COLLECTION);
    const existing = await admins.findOne({ number });

    if (existing?.active) {
        return reply(
            sock,
            msg,
            `⚠️ This number is already an admin.\n\n🆔 Admin ID: ${existing.adminId}`
        );
    }

    const adminId = existing?.adminId || await generateAdminId();
    const now = new Date();

    const adminName =
        String(args.slice(2).join(" ").trim() || "Bot Admin").slice(0, 100);

    const record = {
        adminId,
        number,
        name: adminName,
        active: true,
        appointedAt: existing?.appointedAt || now,
        appointedBy: OWNER_NUMBER,
        updatedAt: now,
        removedAt: null,
        removedBy: null
    };

    await admins.updateOne(
        { number },
        { $set: record },
        { upsert: true }
    );

    await writeLog({
        actorNumber: OWNER_NUMBER,
        actorName: displayName(msg),
        actorAdminId: "OWNER",
        action: "ADMIN_ADDED",
        targetNumber: number,
        details: {
            adminId,
            adminName,
            appointedAt: now
        }
    });

    try {
        await sock.sendMessage(chatJid(number), {
            text: `
👑 *SHAN MINI BOT — ADMIN ACTIVATED*

🎉 You have been appointed as a Bot Admin.

🆔 *Admin ID:* ${adminId}
👤 *Admin Name:* ${adminName}
📱 *Number:* ${number}
📅 *Appointed:* ${dateText(now)}
🔐 *Appointed By:* OWNER

*YOUR PERMISSIONS*

✅ Grant Premium (on the bot you use the command on)
✅ Remove Premium
✅ View Premium users
✅ Block and unblock users

❌ Cannot appoint or remove admins
❌ Cannot view the admin list

⚡ *POWERED BY SHAN MINI BOT* 💙
            `.trim()
        });
    } catch (error) {
        console.error("[BOTADMIN] Notification failed:", error.message);
    }

    return reply(
        sock,
        msg,
        `✅ *ADMIN APPOINTED SUCCESSFULLY*\n\n🆔 Admin ID: ${adminId}\n👤 Name: ${adminName}\n📱 Number: ${number}\n📅 Date: ${dateText(now)}`
    );
}

// -----------------------------------------------------
// REMOVE ADMIN
// -----------------------------------------------------

async function removeAdmin(sock, msg, args) {
    if (!isOwner(msg)) {
        return reply(
            sock,
            msg,
            "❌ Only the main owner can remove bot admins."
        );
    }

    const number = cleanNumber(args[1]);

    if (!number) {
        return reply(
            sock,
            msg,
            "❌ Usage:\n.botadmin remove <number>"
        );
    }

    const admins = db().collection(ADMIN_COLLECTION);
    const admin = await admins.findOne({
        number,
        active: true
    });

    if (!admin) {
        return reply(sock, msg, "❌ Active admin not found.");
    }

    const now = new Date();

    await admins.updateOne(
        { number, active: true },
        {
            $set: {
                active: false,
                removedAt: now,
                removedBy: OWNER_NUMBER,
                updatedAt: now
            }
        }
    );

    await writeLog({
        actorNumber: OWNER_NUMBER,
        actorName: displayName(msg),
        actorAdminId: "OWNER",
        action: "ADMIN_REMOVED",
        targetNumber: number,
        details: {
            adminId: admin.adminId,
            adminName: admin.name,
            removedAt: now
        }
    });

    try {
        await sock.sendMessage(chatJid(number), {
            text: `
⚠️ *SHAN MINI BOT — ADMIN ACCESS REMOVED*

👤 Name: ${admin.name}
🆔 Admin ID: ${admin.adminId}
📅 Date: ${dateText(now)}

Your Bot Admin permissions have been removed.

⚡ SHAN MINI BOT
            `.trim()
        });
    } catch (error) {
        console.error("[BOTADMIN] Removal notice failed:", error.message);
    }

    return reply(
        sock,
        msg,
        `✅ *ADMIN REMOVED*\n\n👤 Name: ${admin.name}\n🆔 ID: ${admin.adminId}\n📱 Number: ${number}\n📅 Removed: ${dateText(now)}`
    );
}

// -----------------------------------------------------
// ADMIN LIST — OWNER ONLY
// -----------------------------------------------------

async function adminList(sock, msg) {
    if (!isOwner(msg)) {
        return reply(sock, msg, "❌ Only the owner can view the admin list.");
    }

    const admins = await db()
        .collection(ADMIN_COLLECTION)
        .find({ active: true })
        .sort({ appointedAt: -1 })
        .toArray();

    if (!admins.length) {
        return reply(sock, msg, "📭 No active bot admins.");
    }

    const lines = admins.map((admin, index) => {
        return (
            `${index + 1}. 👤 ${admin.name}\n` +
            `   🆔 ${admin.adminId}\n` +
            `   📱 ${admin.number}\n` +
            `   📅 ${dateText(admin.appointedAt)}`
        );
    });

    return reply(
        sock,
        msg,
        `👑 *SHAN MINI BOT — ADMIN LIST*\n\n${lines.join("\n\n")}\n\nTotal: ${admins.length}`
    );
}

// -----------------------------------------------------
// ADMIN INFO — OWNER ONLY
// -----------------------------------------------------

async function adminInfo(sock, msg, args) {
    if (!isOwner(msg)) {
        return reply(sock, msg, "❌ Only the owner can view admin details.");
    }

    const input = String(args[0] || "").trim();
    const number = cleanNumber(input);

    const query = input.startsWith("SHAN-ADM-")
        ? { adminId: input.toUpperCase() }
        : { number };

    if (!input) {
        return reply(sock, msg, "❌ Usage:\n.admininfo <number-or-admin-id>");
    }

    const admin = await db().collection(ADMIN_COLLECTION).findOne(query);

    if (!admin) {
        return reply(sock, msg, "❌ Admin record not found.");
    }

    return reply(
        sock,
        msg,
        `👑 *ADMIN INFORMATION*\n\n👤 Name: ${admin.name}\n🆔 ID: ${admin.adminId}\n📱 Number: ${admin.number}\n📊 Status: ${admin.active ? "ACTIVE" : "REMOVED"}\n📅 Appointed: ${dateText(admin.appointedAt)}\n👑 Appointed By: ${admin.appointedBy || OWNER_NUMBER}\n📅 Removed: ${dateText(admin.removedAt)}`
    );
}

// -----------------------------------------------------
// ADMIN ACTIVITY LOGS — OWNER ONLY
// -----------------------------------------------------

async function adminLogs(sock, msg, args) {
    if (!isOwner(msg)) {
        return reply(sock, msg, "❌ Only the owner can view admin activity logs.");
    }

    const input = String(args[0] || "").trim();
    const filter = {};

    if (input.startsWith("SHAN-ADM-")) {
        filter.actorAdminId = input.toUpperCase();
    } else if (input) {
        filter.actorNumber = cleanNumber(input);
    }

    const logs = await db()
        .collection(LOG_COLLECTION)
        .find(filter)
        .sort({ createdAt: -1 })
        .limit(20)
        .toArray();

    if (!logs.length) {
        return reply(sock, msg, "📭 No activity logs found.");
    }

    const lines = logs.map((log, index) => {
        const details = log.details || {};

        return (
            `${index + 1}. ⚡ ${log.action}\n` +
            `👤 Admin: ${log.actorName}\n` +
            `🆔 Admin ID: ${log.actorAdminId}\n` +
            `📱 Admin Number: ${log.actorNumber}\n` +
            `🎯 Target: ${log.targetNumber || "N/A"}\n` +
            `📅 Date: ${dateText(log.createdAt)}\n` +
            `📌 Details: ${JSON.stringify(details).slice(0, 250)}`
        );
    });

    return reply(
        sock,
        msg,
        `👑 *ADMIN ACTIVITY LOGS*\n\n${lines.join("\n\n")}\n\nShowing latest ${logs.length} records.`
    );
}

// -----------------------------------------------------
// BLOCK / UNBLOCK
// Uses botsettings.bannedUsers, checked by index.js
// -----------------------------------------------------

async function changeBlockedStatus(sock, msg, args, shouldBlock) {
    if (!(await isAuthorized(senderNumber(msg)))) {
        return reply(sock, msg, "❌ Only the owner or a bot admin can use this command.");
    }

    const number = cleanNumber(args[0]);

    if (!number || number.length < 8 || number.length > 15) {
        return reply(
            sock,
            msg,
            `❌ Usage:\n.${shouldBlock ? "adminblock" : "adminunblock"} <number>`
        );
    }

    if (isOwnerNumber(number)) {
        return reply(sock, msg, "❌ The main owner cannot be blocked.");
    }

    if (await isAdminNumber(number)) {
        return reply(sock, msg, "❌ Bot admins cannot be blocked using this command.");
    }

    const actor = await logActor(msg);
    const settings = db().collection(SETTINGS_COLLECTION);
    const document = await settings.findOne({});

    if (!document) {
        await settings.insertOne({
            bannedUsers: shouldBlock ? [number] : [],
            createdAt: new Date()
        });
    } else if (shouldBlock) {
        await settings.updateOne(
            { _id: document._id },
            { $addToSet: { bannedUsers: number } }
        );
    } else {
        await settings.updateOne(
            { _id: document._id },
            { $pull: { bannedUsers: number } }
        );
    }

    await writeLog({
        actorNumber: actor.number,
        actorName: actor.name,
        actorAdminId: actor.adminId,
        action: shouldBlock ? "USER_BLOCKED" : "USER_UNBLOCKED",
        targetNumber: number,
        details: {
            actionAt: new Date()
        }
    });

    return reply(
        sock,
        msg,
        `${shouldBlock ? "🚫 USER BLOCKED" : "✅ USER UNBLOCKED"}\n\n📱 Number: ${number}\n👤 Action By: ${actor.name}\n🆔 Admin ID: ${actor.adminId}\n📅 Date: ${dateText(new Date())}`
    );
}

// -----------------------------------------------------
// MAIN EXECUTE
// index.js calls execute(sock, msg, args, commandName)
// -----------------------------------------------------

export const commands = COMMANDS;

export async function execute(sock, msg, args = [], commandName = "") {
    const command = String(commandName || "").toLowerCase();

    try {
        // Admin management is owner-only.
        if (command === "botadmin") {
            if (!isOwner(msg)) {
                return reply(sock, msg, "❌ Only the main owner can manage bot admins.");
            }

            const action = String(args[0] || "").toLowerCase();

            if (action === "add") {
                return addAdmin(sock, msg, args);
            }

            if (action === "remove") {
                return removeAdmin(sock, msg, args);
            }

            if (action === "list") {
                return adminList(sock, msg);
            }

            return reply(
                sock,
                msg,
                `👑 *BOT ADMIN MANAGEMENT*

.botadmin add <number>
.botadmin remove <number>
.botadmin list

Example:
.botadmin add 94712345678`
            );
        }

        if (command === "admininfo") {
            return adminInfo(sock, msg, args);
        }

        if (command === "adminlogs") {
            return adminLogs(sock, msg, args);
        }

        if (command === "adminblock") {
            return changeBlockedStatus(sock, msg, args, true);
        }

        if (command === "adminunblock") {
            return changeBlockedStatus(sock, msg, args, false);
        }

        return reply(sock, msg, "❌ Unknown command.");
    } catch (error) {
        console.error("[BOTADMIN ERROR]", error.stack || error.message || error);

        return reply(
            sock,
            msg,
            `❌ Command failed.\n\n${error.message || "Unknown error"}`
        );
    }
}

export default {
    commands,
    execute
};
