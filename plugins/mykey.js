import mongoose from "mongoose";
import * as baileys from "@whiskeysockets/baileys";
import { getOrCreateKey } from "../api.js";

async function sendKeyWithCopy(sock, jid, key, quoted) {
  const { proto, generateWAMessageFromContent } = baileys;

  const content = {
    viewOnceMessage: {
      message: {
        messageContextInfo: {
          deviceListMetadata: {},
          deviceListMetadataVersion: 2
        },
        interactiveMessage: proto.Message.InteractiveMessage.create({
          body: proto.Message.InteractiveMessage.Body.create({
            text:
              "🔑 *YOUR API KEY*\n\n" +
              "```" + key + "```\n\n" +
              "⚠️ Do not share this key with anyone."
          }),
          footer: proto.Message.InteractiveMessage.Footer.create({
            text: "SHAN MINI BOT"
          }),
          nativeFlowMessage:
            proto.Message.InteractiveMessage.NativeFlowMessage.create({
              buttons: [
                {
                  name: "cta_copy",
                  buttonParamsJson: JSON.stringify({
                    display_text: "📋 Copy API Key",
                    id: "copy_key",
                    copy_code: key
                  })
                }
              ]
            })
        })
      }
    }
  };

  const out = generateWAMessageFromContent(jid, content, {
    quoted,
    userJid: sock.user?.id
  });

  await sock.relayMessage(jid, out.message, {
    messageId: out.key.id,
    additionalNodes: [
      {
        tag: "biz",
        attrs: {},
        content: [
          {
            tag: "interactive",
            attrs: { type: "native_flow", v: "1" },
            content: [
              { tag: "native_flow", attrs: { v: "9", name: "mixed" } }
            ]
          }
        ]
      }
    ]
  });
}

export default {
  command: ["mykey", "apikey"],

  async execute(sock, msg) {
    const chat = msg.key.remoteJid;

    try {
      const clean = globalThis.SHAN_CLEAN_NUMBER;
      const number = clean(globalThis.SHAN_GET_SENDER(msg));
      const isGroup = String(chat).endsWith("@g.us");

      if (!number) return;

      let key = null;

      if (globalThis.SHAN_IS_OWNER_MSG(msg)) {
        key = await getOrCreateKey(number);
      } else {
        const doc = await mongoose.connection
          .collection("apikeys")
          .findOne({ number, active: { $ne: false } });

        key = doc?.key || null;
      }

      if (!key) {
        await sock.sendMessage(
          chat,
          {
            text: "⛔ This command is only available to the bot owner and users who have connected their bots."
          },
          { quoted: msg }
        );
        return;
      }

      // Group එකේ ගැහුවොත් inbox එකට, inbox එකේ ගැහුවොත් ඒ chat එකටම
      const target = isGroup ? `${number}@s.whatsapp.net` : chat;

      await sendKeyWithCopy(sock, target, key, isGroup ? undefined : msg);

      if (isGroup) {
        await sock.sendMessage(
          chat,
          { text: "📩 Your API key has been sent to your private chat." },
          { quoted: msg }
        );
      }
    } catch (error) {
      console.error("❌ mykey error:", error?.stack || error?.message || error);

      await sock.sendMessage(
        chat,
        { text: `❌ mykey failed: ${error?.message || error}` },
        { quoted: msg }
      );
    }
  }
};