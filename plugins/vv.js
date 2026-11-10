import * as baileys from "@whiskeysockets/baileys";

/*
  SHAN MINI BOT V1 — VV (View Once Saver)

  ALWAYS ON — no command needed.
  If someone replies to a view-once photo, video, or audio
  message, the bot saves that media and sends it ONLY to
  the linked bot number's WhatsApp inbox.

  FIXES (Waiting for this message):
  - Inbox JID is built with jidNormalizedUser(sock.user.id)
  - Media download supports re-upload request
  - Sends are retried and spaced out
  (The root "Waiting for this message" fix is the getMessage
  store wired up in index.js — make sure that file is deployed.)
*/

const { downloadContentFromMessage, downloadMediaMessage, jidNormalizedUser } = baileys;

/* ---------- HELPERS ---------- */

const clean = v =>
  String(v || "").split("@")[0].split(":")[0].replace(/\D/g, "");

const botKeyOf = sock => clean(sock?.user?.id) || "main";

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Correct self JID (no device suffix)
function inboxOf(sock) {
  try {
    if (sock?.user?.id) {
      return jidNormalizedUser(sock.user.id);
    }
  } catch {}

  return `${botKeyOf(sock)}@s.whatsapp.net`;
}

// Send with retry (fixes random "Waiting for this message")
async function safeSend(sock, jid, content, tries = 3) {
  let lastErr;

  for (let i = 0; i < tries; i++) {
    try {
      const res = await sock.sendMessage(jid, content);
      await sleep(800);
      return res;
    } catch (error) {
      lastErr = error;
      console.log(
        `👁️ [VV] Send attempt ${i + 1} failed: ${error?.message || error}`
      );
      await sleep(1500 * (i + 1));
    }
  }

  throw lastErr;
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

  /* .vv → status only (feature is always running, no on/off needed) */
  async execute(sock, msg) {
    const chat = msg.key.remoteJid;

    return sock.sendMessage(
      chat,
      {
        text:
          "👁️ VV is always ON.\n\nReply to anyone's view-once photo, video or voice note and it's auto-saved to this bot's inbox. No command needed."
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
        if (Object.keys(quoted).some(k => MEDIA_KEYS.includes(k))) {
          console.log(
            `👁️ [VV] Reply to media, not view-once (quoted keys: ${Object.keys(quoted).join(", ")})`
          );
        }

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
          buffer = await downloadMediaMessage(
            orig,
            "buffer",
            {},
            {
              reuploadRequest: sock.updateMediaMessage
            }
          );
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

      if (!buffer || !buffer.length) {
        handled.delete(dedupeKey);
        console.error("❌ [VV] Empty media buffer.");
        return;
      }

      // Send media only to the linked bot number (normalized self JID)
      const inbox = inboxOf(sock);

      const replier = clean(
        msg.key.participant || msg.key.participantPn || msg.key.remoteJid
      );

      const info =
        `👁️ *VV — VIEW ONCE SAVED*\n\n` +
        `💬 Chat: ${jid.endsWith("@g.us") ? "Group" : "Private"} (${clean(jid) || jid})\n` +
        `👤 Replied By: ${replier || "Unknown"}\n` +
        (found.media.caption ? `📝 Caption: ${found.media.caption}\n` : "");

      try {
        if (found.type === "image") {
          await safeSend(sock, inbox, { image: buffer, caption: info });
        } else if (found.type === "video") {
          await safeSend(sock, inbox, {
            video: buffer,
            caption: info,
            mimetype: found.media.mimetype || "video/mp4"
          });
        } else {
          await safeSend(sock, inbox, {
            audio: buffer,
            mimetype: found.media.mimetype || "audio/ogg; codecs=opus",
            ptt: found.media.ptt === true
          });

          await sleep(1000);

          await safeSend(sock, inbox, { text: info });
        }
      } catch (error) {
        handled.delete(dedupeKey);
        throw error;
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
