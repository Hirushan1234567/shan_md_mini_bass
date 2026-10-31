import bwipjs from "bwip-js";

export default {
  command: "barcode",
  category: "utility",
  description: "Generate a barcode image",

  async execute(sock, msg, args) {
    const jid = msg.key.remoteJid;

    try {
      const text = args.join(" ").trim();

      if (!/^\d{8,14}$/.test(text)) {
        return sock.sendMessage(jid, {
          text: "Usage: .barcode 123456789012\n\nEnter 8, 12, or 13 digits for a standard retail barcode, or 8–14 digits for an ITF barcode."
        }, { quoted: msg });
      }

      const buffer = await bwipjs.toBuffer({
        bcid: "code128",
        text,
        scale: 3,
        height: 15,
        includetext: true,
        textxalign: "center"
      });

      await sock.sendMessage(jid, {
        document: buffer,
        mimetype: "image/png",
        fileName: "barcode.png",
        caption: "🏷️ Your barcode is ready."
      }, { quoted: msg });

    } catch (error) {
      console.error("[barcode]", error);

      await sock.sendMessage(jid, {
        text: "❌ Failed to generate the barcode."
      }, { quoted: msg });
    }
  }
};