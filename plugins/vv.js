import * as baileys from "@whiskeysockets/baileys";
import mongoose from "mongoose";

/*
  SHAN MINI BOT V1 — VV (View Once Saver)

  .vv on      → Enable VV
  .vv off     → Disable VV
  .vv         → Check VV status

  Can also be controlled through the "VV Save" option
  in .settings (uses the same setting).

  When VV is ON:
  If someone replies to a view-once photo, video, or audio
  message, the bot saves that media and sends it ONLY to
  the linked bot number's WhatsApp inbox.

  Nothing is sent to the original chat.

  How it works:
  - Remembers incoming view-once messages (metadata only).
  - Detects replies to those messages.
  - Downloads the original media when someone replies.
  - If the original message is unavailable, tries the
    quoted media as a fallback.
*/

const { downloadContentFromMessage, downloadMediaMessage } = baileys;

/* ---------- HELPERS ---------- */

const clean = v =>
  String(v || "").split("@")[0].split(":")[0].replace(/\D/g, "");

const botKeyOf = sock => clean(sock?.user?.id) || "main";

// VV ON/OFF — Reads directly from botsettings.vv
let vvCache = { at: 0, on: false };

async function isOn() {
  if (Date.now() - vvCache.at < 5000) {
    return vvCache.on;
  }

  let on = false;

  try {
    if (mongoose.connection.readyState === 1) {
      const doc = await mongoose.connection.collection("botsettings").findOne({});
      on = doc?.vv === true;
    }
  } catch {}

  vvCache = { at: Date.now(), on };
  return on;
}

async function setOn(on) {
  await mongoose.connection
    .collection("botsettings")
    .updateOne({}, { $set: { vv: on } }, { upsert: true });

  vvCache = { at: Date.now(), on };
}

// Remove ephemeral and view-once wrappers
function unwrap(message) {
  let m = message;

  for (let i = 0; i < 5 && m; i++) {
    const inner =
      m.ephemeralMessage?.message ||
      m.viewOnceMessage?.message ||
      m.viewOnceMessageV2?.message ||
      m.viewOnceMessageV2Extension?.message ||
      m.documentWithCaptionMessage?.message;

    if (!inner) {
      break;
    }

    m = inner;
  }

  return m;
}

// Extract contextInfo from any message type
function getContextInfo(message) {
  const m = unwrap(message);

  if (!m) {
    return null;
  }

  for (const value of Object.values(m)) {
    if (value && typeof value === "object" && value.contextInfo) {
      return value.contextInfo;
    }
  }

  return null;
}

// Detect view-once media and return { type, media }
function findViewOnce(message) {
  if (!message) {
    return null;
  }

  const base = message.ephemeralMessage?.message || message;

  const wrapped =
    base.viewOnceMessage?.message ||
    base.viewOnceMessageV2?.message ||
    base.viewOnceMessageV2Extension?.message ||
    null;

  const inner = wrapped || unwrap(base);

  if (!inner) {
    return null;
  }

  const types = [
    ["imageMessage", "image"],
    ["videoMessage", "video"],
    ["audioMessage", "audio"]
  ];

  for (const [field, type] of types) {
    const media = inner[field];

    if (!media) {
      continue;
    }

    if (wrapped || media.viewOnce === true) {
      return { type, media };
    }
  }

  return null;
}

async function downloadQuoted(media, type) {
  const stream = await downloadContentFromMessage(media, type);
  const chunks = [];

  for await (const chunk of stream) {
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

/* ---------- ORIGINAL VIEW-ONCE MESSAGES ---------- */

// Store message metadata only
const voStore = new Map();
const VO_LIMIT = 500;

function rememberViewOnce(msg) {
  const id = msg?.key?.id;

  if (!id || !msg?.message) {
    return;
  }

  if (!findViewOnce(msg.message)) {
    return;
  }

  voStore.set(id, msg);

  if (voStore.size > VO_LIMIT) {
    voStore.delete(voStore.keys().next().value);
  }
}

// Prevent duplicate saves for one hour
const handled = new Map();

setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000;

  for (const [k, t] of handled) {
    if (t < cutoff) {
      handled.delete(k);
    }
  }
}, 10 * 60 * 1000).unref?.();

const MEDIA_KEYS = [
  "imageMessage",
  "videoMessage",
  "audioMessage",
  "viewOnceMessage",
  "viewOnceMessageV2",
  "viewOnceMessageV2Extension"
];

/* ---------- PLUGIN ---------- */

export default {
  command: ["vv"],

  /* .vv on / off / status */
  async execute(sock, msg, args) {
    const chat = msg.key.remoteJid;
    const sender = globalThis.SHAN_GET_SENDER?.(msg);

    const allowed =
      globalThis.SHAN_IS_OWNER_MSG?.(msg) ||
      (msg.__shanSub &&
        (msg.key.fromMe === true || clean(sender) === clean(msg.__shanSub)));

    if (!allowed) {
      return sock.sendMessage(
        chat,
        { text: "⛔ Owner only command." },
        { quoted: msg }
      );
    }

    const arg = String(args[0] || "").toLowerCase();

    if (arg === "on" || arg === "off") {
      await setOn(arg === "on");

      return sock.sendMessage(
        chat,
        {
          text:
            arg === "on"
              ? "✅ VV ENABLED\n\nWhen someone replies to a view-once photo, video, or audio message, the media will be sent to this bot number's inbox."
              : "⛔ VV DISABLED"
        },
        { quoted: msg }
      );
    }

    const on = await isOn();

    return sock.sendMessage(
      chat,
      {
        text: `👁️ VV STATUS: ${on ? "ON ✅" : "OFF ⛔"}\n\nUsage:\n.vv on\n.vv off`
      },
      { quoted: msg }
    );
  },

  /* Background handler — Runs on every incoming message */
  async handleMessage(sock, msg) {
    try {
      const jid = String(msg?.key?.remoteJid || "");

      if (!jid || jid === "status@broadcast" || jid.endsWith("@newsletter")) {
        return;
      }

      if (!msg?.message) {
        return;
      }

      // 1. Remember incoming view-once messages
      rememberViewOnce(msg);

      // 2. Check whether this message is a reply
      const ctx = getContextInfo(msg.message);
      const quoted = ctx?.quotedMessage;

      if (!quoted) {
        return;
      }

      const stanza = ctx.stanzaId || "";
      const orig = stanza ? voStore.get(stanza) : null;

      let found = findViewOnce(quoted);

      if (!found && orig) {
        found = findViewOnce(orig.message);
      }

      if (!found) {
        // Debug: Reply to media that was not detected as view-once
        if (
          (await isOn()) &&
          Object.keys(quoted).some(k => MEDIA_KEYS.includes(k))
        ) {
          console.log(
            `👁️ [VV] Reply to media, not view-once (quoted keys: ${Object.keys(quoted).join(", ")})`
          );
        }

        return;
      }

      if (!(await isOn())) {
        return;
      }

      const botKey = botKeyOf(sock);
      const dedupeKey = `${botKey}:${stanza || msg.key.id}`;

      if (handled.has(dedupeKey)) {
        return;
      }

      handled.set(dedupeKey, Date.now());

      // 3. Download original media first, then quoted media
      let buffer = null;

      if (orig) {
        try {
          buffer = await downloadMediaMessage(orig, "buffer", {});
        } catch (error) {
          console.log(
            `👁️ [VV] Original download failed: ${error?.message || error}`
          );
        }
      }

      if (!buffer) {
        try {
          buffer = await downloadQuoted(found.media, found.type);
        } catch (error) {
          handled.delete(dedupeKey);

          console.error(
            `❌ [VV] Download failed (${orig ? "original + quoted" : "quoted only"}): ${error?.message || error}`
          );

          return;
        }
      }

      // Send media only to the linked bot number
      const inbox = `${botKey}@s.whatsapp.net`;

      const replier = clean(
        msg.key.participant || msg.key.participantPn || msg.key.remoteJid
      );

      const info =
        `👁️ *VV — VIEW ONCE SAVED*\n\n` +
        `💬 Chat: ${jid.endsWith("@g.us") ? "Group" : "Private"} (${clean(jid) || jid})\n` +
        `👤 Replied By: ${replier || "Unknown"}\n` +
        (found.media.caption ? `📝 Caption: ${found.media.caption}\n` : "");

      if (found.type === "image") {
        await sock.sendMessage(inbox, {
          image: buffer,
          caption: info
        });
      } else if (found.type === "video") {
        await sock.sendMessage(inbox, {
          video: buffer,
          caption: info
        });
      } else {
        await sock.sendMessage(inbox, {
          audio: buffer,
          mimetype: found.media.mimetype || "audio/ogg; codecs=opus",
          ptt: found.media.ptt === true
        });

        await sock.sendMessage(inbox, {
          text: info
        });
      }

      console.log(
        `👁️ [VV ${botKey}] ${found.type} saved to inbox successfully.`
      );

    } catch (error) {
      console.error(
        "❌ VV Error:",
        error?.stack || error?.message || error
      );
    }
  }
};