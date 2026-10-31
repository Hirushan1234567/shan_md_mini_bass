import jsQR from "jsqr";
import sharp from "sharp";
import { downloadContentFromMessage } from "@whiskeysockets/baileys";

export default {
  command: "qrreader",
  category: "utility",
  description: "Read QR codes from images",

  async execute(sock, msg) {
    const jid = msg.key.remoteJid;

    try {
      const message = msg.message || {};
      const context =
        message.extendedTextMessage?.contextInfo ||
        message.imageMessage?.contextInfo ||
        {};

      const quoted = context.quotedMessage || {};

      const image =
        message.imageMessage ||
        quoted.imageMessage;

      if (!image) {
        return sock.sendMessage(jid, {
          text: "Please send an image containing a QR code or reply to one with .qrreader"
        }, { quoted: msg });
      }

      const stream = await downloadContentFromMessage(image, "image");
      const chunks = [];

      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      const buffer = Buffer.concat(chunks);

      const { data, info } = await sharp(buffer)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

      const code = jsQR(
        new Uint8ClampedArray(data),
        info.width,
        info.height
      );

      if (!code) {
        return sock.sendMessage(jid, {
          text: "❌ No QR code was detected in this image."
        }, { quoted: msg });
      }

      await sock.sendMessage(jid, {
        text: `📷 *QR CODE RESULT*\n\n${code.data}`
      }, { quoted: msg });

    } catch (error) {
      console.error("[qrreader]", error);

      await sock.sendMessage(jid, {
        text: "❌ Failed to read the QR code."
      }, { quoted: msg });
    }
  }
};