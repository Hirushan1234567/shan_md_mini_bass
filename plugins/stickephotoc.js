// SHAN MINI BOT — Sticker plugin (ES Module compatible)
import { Sticker, StickerTypes } from "wa-sticker-formatter";

export default {
  name: "sticker",
  command: "sticker",
  commands: ["sticker", "s", "stiker"],
  alias: ["s", "stiker"],
  description: "Photo to Sticker",
  category: "fun",
  async execute(sock, msg) {
    const jid = msg?.key?.remoteJid;
    if (!jid) return false;
    const reply = text => sock.sendMessage(jid, { text }, { quoted: msg });
    try {
      const quoted = msg?.quoted || msg;
      const mime = quoted?.msg?.mimetype || quoted?.mimetype ||
        msg?.message?.imageMessage?.mimetype ||
        msg?.message?.videoMessage?.mimetype || "";
      if (!/image|video/i.test(mime)) {
        return reply("❌ Image/video එකකට reply කරලා .sticker ගහන්න.\nExample: .sticker");
      }
      if (typeof quoted.download !== "function") {
        return reply("❌ මේ message format එකෙන් media download කරන්න බැහැ. Image එකට reply කරලා නැවත උත්සාහ කරන්න.");
      }
      await sock.sendMessage(jid, { react: { text: "⏳", key: msg.key } });
      const media = await quoted.download();
      const sticker = new Sticker(media, {
        pack: "SHAN MINI BOT",
        author: "SHAN MINI BOT",
        type: StickerTypes.FULL,
        quality: 70
      });
      const buffer = await sticker.toBuffer();
      await sock.sendMessage(jid, { sticker: buffer }, { quoted: msg });
      await sock.sendMessage(jid, { react: { text: "✅", key: msg.key } });
    } catch (error) {
      console.error("Sticker Error:", error);
      return reply("❌ Sticker error: " + (error?.message || error));
    }
  }
};
