/*
  .broadcast <message>  (alias: .bc)
  බොට් link කරලා ඉන්න හැම number එකකම inbox එකට message එක යනවා.
  Owner (main bot) විතරයි පාවිච්චි කරන්න පුළුවන්.
*/

const sleep = ms => new Promise(r => setTimeout(r, ms));

export default {
  command: ["broadcast", "bc"],

  async execute(sock, msg, args) {
    const chat = msg.key.remoteJid;

    if (!globalThis.SHAN_IS_OWNER_MSG(msg) || msg.__shanSub) {
      return sock.sendMessage(
        chat,
        { text: "⛔ Owner only command." },
        { quoted: msg }
      );
    }

    const text = args.join(" ").trim();

    if (!text) {
      return sock.sendMessage(
        chat,
        { text: "📝 Usage: .broadcast <message>" },
        { quoted: msg }
      );
    }

    const entries = [...(globalThis.SHAN_SOCKETS || new Map()).values()];
    let sent = 0;

    for (const { sock: s } of entries) {
      try {
        const num = String(s.user?.id || "").split(":")[0].split("@")[0];

        if (!num) {
          continue;
        }

        await s.sendMessage(`${num}@s.whatsapp.net`, {
          text: `📢 *BROADCAST — SHAN MINI BOT*\n\n${text}`
        });

        sent++;
      } catch (e) {
        console.error("❌ broadcast error:", e?.message || e);
      }

      // spam / ban වළක්වන්න delay එකක්
      await sleep(1500);
    }

    return sock.sendMessage(
      chat,
      { text: `✅ Broadcast sent: ${sent}/${entries.length} bots` },
      { quoted: msg }
    );
  }
};
