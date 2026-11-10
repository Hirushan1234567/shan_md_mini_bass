import * as baileys from "@whiskeysockets/baileys";

const { downloadContentFromMessage } = baileys;

function getContextInfo(message) {
  if (!message || typeof message !== "object") return null;

  for (const value of Object.values(message)) {
    if (value && typeof value === "object") {
      if (value.contextInfo) return value.contextInfo;
      const nested = getContextInfo(value);
      if (nested) return nested;
    }
  }

  return null;
}

// Unwrap normal ephemeral/caption wrappers, but never unwrap View Once media.
function getNormalMedia(message) {
  let current = message;

  for (let i = 0; i < 5 && current; i++) {
    if (
      current.viewOnceMessage ||
      current.viewOnceMessageV2 ||
      current.viewOnceMessageV2Extension
    ) {
      return null;
    }

    if (current.ephemeralMessage?.message) {
      current = current.ephemeralMessage.message;
      continue;
    }

    if (current.documentWithCaptionMessage?.message) {
      current = current.documentWithCaptionMessage.message;
      continue;
    }

    break;
  }

  for (const [key, type] of [
    ["imageMessage", "image"],
    ["videoMessage", "video"],
    ["audioMessage", "audio"]
  ]) {
    const media = current?.[key];

    if (media && media.viewOnce !== true) {
      return { media, type };
    }
  }

  return null;
}

async function downloadMedia(media, type) {
  const stream = await downloadContentFromMessage(media, type);
  const chunks = [];

  for await (const chunk of stream) {
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

export default {
  command: ["save"],

  async execute(sock, msg) {
    const chat = msg?.key?.remoteJid;

    if (!chat) return;

    const context = getContextInfo(msg.message);
    const quoted = context?.quotedMessage;

    if (!quoted) {
      return sock.sendMessage(
        chat,
        { text: "↩️ Reply to a normal photo, video, or audio message with .save." },
        { quoted: msg }
      );
    }

    const found = getNormalMedia(quoted);

    if (!found) {
      return sock.sendMessage(
        chat,
        { text: "⛔ .save supports ordinary photos, videos, and audio only. View Once media cannot be saved." },
        { quoted: msg }
      );
    }

    try {
      const buffer = await downloadMedia(found.media, found.type);
      const caption = found.media.caption || undefined;

      if (found.type === "image") {
        await sock.sendMessage(chat, { image: buffer, caption });
      } else if (found.type === "video") {
        await sock.sendMessage(chat, { video: buffer, caption });
      } else {
        await sock.sendMessage(chat, {
          audio: buffer,
          mimetype: found.media.mimetype || "audio/ogg; codecs=opus",
          ptt: found.media.ptt === true
        });
      }
    } catch (error) {
      console.error("❌ SAVE plugin error:", error?.message || error);
      await sock.sendMessage(
        chat,
        { text: "❌ Could not download that media. Please try again." },
        { quoted: msg }
      );
    }
  }
};
