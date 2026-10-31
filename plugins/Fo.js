// plugins/forward.js
// SHAN MINI BOT V1 — Forward Plugin
// Baileys + ES Modules
//
// Commands:
// .forward <number | jid | group link | channel link>
// .fwd <number | jid | group link | channel link>
//
// Reply to a message before using the command.

import { downloadMediaMessage } from "@whiskeysockets/baileys";

const silentLogger = {
  level: "silent",
  info() {},
  error() {},
  warn() {},
  debug() {},
  trace() {},
  fatal() {},
  child() {
    return this;
  }
};

function unwrap(message) {
  let current = message;

  for (let i = 0; i < 8 && current; i++) {
    const wrapped =
      current.ephemeralMessage?.message ||
      current.viewOnceMessage?.message ||
      current.viewOnceMessageV2?.message ||
      current.viewOnceMessageV2Extension?.message ||
      current.documentWithCaptionMessage?.message;

    if (!wrapped) break;
    current = wrapped;
  }

  return current;
}

function getQuoted(msg) {
  const message = unwrap(msg?.message);
  if (!message) return null;

  const type = Object.keys(message).find(
    key =>
      message[key] &&
      typeof message[key] === "object" &&
      message[key].contextInfo
  );

  const contextInfo = type ? message[type].contextInfo : null;
  if (!contextInfo?.quotedMessage || !contextInfo?.stanzaId) return null;

  return {
    key: {
      remoteJid: msg.key.remoteJid,
      id: contextInfo.stanzaId,
      fromMe: false,
      participant: contextInfo.participant
    },
    message: contextInfo.quotedMessage
  };
}

function digitsOf(value) {
  return String(value || "")
    .split(":")[0]
    .split("@")[0]
    .replace(/\D/g, "");
}

async function isSessionOwner(sock, msg, context = {}) {
  // A message sent by the linked bot account itself.
  if (msg?.key?.fromMe) return true;

  const senders = [
    context.sender,
    msg?.key?.participant,
    msg?.key?.participantAlt,
    msg?.key?.participantPn,
    msg?.key?.senderPn,
    msg?.key?.remoteJidAlt,
    !msg?.key?.participant ? msg?.key?.remoteJid : null
  ].filter(Boolean);

  const ownerIds = [
    sock.user?.id,
    sock.user?.phoneNumber,
    sock.user?.lid,
    sock.botNumber
  ]
    .map(digitsOf)
    .filter(Boolean);

  if (senders.some(sender => ownerIds.includes(digitsOf(sender)))) {
    return true;
  }

  // Try resolving a LID sender to the corresponding phone number.
  for (const sender of senders) {
    if (!String(sender).endsWith("@lid")) continue;

    try {
      const phoneNumber =
        await sock.signalRepository?.lidMapping?.getPNForLID?.(sender);

      if (phoneNumber && ownerIds.includes(digitsOf(phoneNumber))) {
        return true;
      }
    } catch {
      // Mapping may not be available in every Baileys version.
    }
  }

  return false;
}

async function resolveJid(sock, input) {
  const value = String(input || "").trim();
  if (!value) return null;

  // WhatsApp group invite link.
  const groupMatch = value.match(
    /chat\.whatsapp\.com\/([A-Za-z0-9]+)/i
  );

  if (groupMatch) {
    const info = await sock.groupGetInviteInfo(groupMatch[1]);
    return info?.id || null;
  }

  // WhatsApp channel invite link.
  const channelMatch = value.match(
    /whatsapp\.com\/channel\/([A-Za-z0-9_-]+)/i
  );

  if (channelMatch) {
    const info = await sock.newsletterMetadata(
      "invite",
      channelMatch[1]
    );

    return info?.id || null;
  }

  // Direct JID.
  if (value.includes("@")) {
    return value.toLowerCase().replace(/:\d+(?=@)/, "");
  }

  // Phone number.
  const digits = value.replace(/\D/g, "");
  if (digits.length >= 8 && digits.length <= 15) {
    return `${digits}@s.whatsapp.net`;
  }

  return null;
}

async function buildNewsletterContent(sock, quoted) {
  const message = unwrap(quoted.message) || {};

  const text =
    message.conversation ||
    message.extendedTextMessage?.text ||
    message.imageMessage?.caption ||
    message.videoMessage?.caption ||
    message.documentMessage?.caption;

  // Text-only messages can be reposted as text.
  if (
    text &&
    !message.imageMessage &&
    !message.videoMessage &&
    !message.audioMessage &&
    !message.documentMessage
  ) {
    return { text };
  }

  const download = () =>
    downloadMediaMessage(
      quoted,
      "buffer",
      {},
      {
        logger: silentLogger,
        reuploadRequest: sock.updateMediaMessage
      }
    );

  if (message.imageMessage) {
    return {
      image: await download(),
      caption: message.imageMessage.caption || ""
    };
  }

  if (message.videoMessage) {
    return {
      video: await download(),
      caption: message.videoMessage.caption || ""
    };
  }

  if (message.audioMessage) {
    return {
      audio: await download(),
      mimetype: message.audioMessage.mimetype || "audio/mpeg",
      ptt: Boolean(message.audioMessage.ptt)
    };
  }

  if (message.documentMessage) {
    return {
      document: await download(),
      mimetype:
        message.documentMessage.mimetype ||
        "application/octet-stream",
      fileName: message.documentMessage.fileName || "file"
    };
  }

  throw new Error(
    "This message type cannot be reposted to a WhatsApp Channel."
  );
}

export default {
  pattern: "forward",
  alias: ["fwd"],
  react: "📨",

  async execute(sock, msg, args, context = {}) {
    const from = context.from || msg?.key?.remoteJid;

    const reply =
      context.reply ||
      (text =>
        sock.sendMessage(
          from,
          { text },
          { quoted: msg }
        ));

    const prefix = context.prefix || ".";

    if (!(await isSessionOwner(sock, msg, context))) {
      return reply(
        "🔒 This command is available only to the owner of this bot session."
      );
    }

    const target = Array.isArray(args)
      ? args.join(" ").trim()
      : String(args || "").trim();

    if (!target) {
      return reply(
        `❌ Reply to the message you want to forward, then use:\n\n` +
        `*${prefix}forward <number | jid | link>*\n\n` +
        `Examples:\n` +
        `${prefix}forward 94771234567\n` +
        `${prefix}forward 120363xxxxxxxxxx@g.us\n` +
        `${prefix}forward 120363xxxxxxxxxx@newsletter\n` +
        `${prefix}forward https://chat.whatsapp.com/INVITECODE\n` +
        `${prefix}forward https://whatsapp.com/channel/CHANNELCODE`
      );
    }

    const quoted = getQuoted(msg);

    if (!quoted) {
      return reply(
        "❌ Please reply directly to the message you want to forward."
      );
    }

    let jid;

    try {
      jid = await resolveJid(sock, target);
    } catch (error) {
      console.error("[FORWARD] Failed to resolve destination:", error);

      return reply(
        `❌ Could not resolve the destination link: ${
          error?.message || "Unknown error"
        }`
      );
    }

    if (!jid) {
      return reply(
        "❌ Invalid destination. Please check the number, JID, or link."
      );
    }

    try {
      if (jid.endsWith("@newsletter")) {
        const content = await buildNewsletterContent(sock, quoted);

        await sock.sendMessage(jid, content);
      } else {
        await sock.sendMessage(jid, {
          forward: quoted
        });
      }

      return reply(
        `✅ Message sent successfully.\n\n` +
        `📍 Destination:\n${jid}`
      );
    } catch (error) {
      console.error("[FORWARD] Send failed:", error);

      return reply(
        `❌ Failed to forward the message.\n` +
        `Reason: ${error?.message || "Unknown error"}`
      );
    }
  }
};