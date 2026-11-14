import mongoose from "mongoose";

function botKey(msg) {
  return msg?.__shanSub
    ? String(msg.__shanSub).replace(/\D/g, "") || "sub"
    : "main";
}

function isBotOwner(msg) {
  if (typeof globalThis.SHAN_IS_OWNER_MSG === "function" && globalThis.SHAN_IS_OWNER_MSG(msg)) {
    return true;
  }

  if (!msg?.__shanSub) return false;
  const ownNumber = String(msg.__shanSub).replace(/\D/g, "");
  const sender = typeof globalThis.SHAN_GET_SENDER === "function"
    ? String(globalThis.SHAN_GET_SENDER(msg)).replace(/\D/g, "")
    : "";
  return msg?.key?.fromMe === true || (ownNumber && sender === ownNumber);
}

async function setMode(msg, enabled) {
  const key = botKey(msg);
  globalThis.SHAN_BUTTON_MODE_CACHE ||= new Map();
  globalThis.SHAN_BUTTON_MODE_CACHE.set(key, enabled);

  if (mongoose.connection.readyState === 1) {
    await mongoose.connection.collection("buttonmodes").updateOne(
      { _id: key },
      { $set: { enabled, updatedAt: new Date() } },
      { upsert: true }
    );
  }

  return key;
}

export default {
  commands: ["setbutton", "unsetbutton"],

  async execute(sock, msg, args, commandName) {
    const jid = msg?.key?.remoteJid;
    if (!jid) return;

    if (!isBotOwner(msg)) {
      await sock.sendMessage(jid, { text: "⛔ මේ command එක Bot Owner ට විතරයි." }, { quoted: msg });
      return;
    }

    const enabled = String(commandName).toLowerCase() === "setbutton";
    const key = await setMode(msg, enabled);

    const status = enabled
      ? "✅ WhatsApp Button Mode ON\n\n📋 Menu  •  🏓 Ping  •  👑 Owner\n\nදැන් plugin එකකින් එන text replies වල buttons පෙන්වයි."
      : "✅ WhatsApp Button Mode OFF\n\nදැන් bot එක සාමාන්‍ය text replies යවයි.";

    await sock.sendMessage(jid, {
      text: status + "\n\nSHAN_BUTTON_MODE_CONTROL"
    }, { quoted: msg });
  }
};
