import mongoose from "mongoose";

/*
  .sts <text>   — සම්බන්ධ කරලා තියෙන හැම bot එකකම status එකක් දානවා
  .delsts       — අන්තිමට දාපු status එක හැම bot එකකින්ම delete කරනවා
  Owner (main bot) විතරයි පාවිච්චි කරන්න පුළුවන්.
*/

const col = () => mongoose.connection.collection("shan_status_posts");
const sleep = ms => new Promise(r => setTimeout(r, ms));

const ownJid = s =>
  `${String(s.user?.id || "").split(":")[0].split("@")[0]}@s.whatsapp.net`;

// Status පෙනෙන්න ඕන අය: bot number එක + bot එකට message කරපු අය
function statusList(botKey, s) {
  return [
    ...new Set([ownJid(s), ...(globalThis.SHAN_CONTACTS?.get(botKey) || [])])
  ];
}

export default {
  command: ["sts", "delsts"],

  async execute(sock, msg, args, cmd) {
    const chat = msg.key.remoteJid;

    if (!globalThis.SHAN_IS_OWNER_MSG(msg) || msg.__shanSub) {
      return sock.sendMessage(
        chat,
        { text: "⛔ Owner only command." },
        { quoted: msg }
      );
    }

    /* ---------- DELETE ---------- */

    if (cmd === "delsts") {
      const doc = await col().findOne({ _id: "latest" });

      if (!doc?.items?.length) {
        return sock.sendMessage(
          chat,
          { text: "ℹ️ Delete කරන්න status එකක් නෑ." },
          { quoted: msg }
        );
      }

      let ok = 0;

      for (const it of doc.items) {
        const entry = globalThis.SHAN_SOCKETS?.get(it.bot);

        if (!entry) {
          continue;
        }

        try {
          await entry.sock.sendMessage(
            "status@broadcast",
            { delete: it.key },
            { statusJidList: statusList(it.bot, entry.sock) }
          );
          ok++;
        } catch (e) {
          console.error(`❌ delsts error (${it.bot}):`, e?.message || e);
        }

        await sleep(800);
      }

      await col().deleteOne({ _id: "latest" });

      return sock.sendMessage(
        chat,
        { text: `🗑️ Status delete කළා: ${ok}/${doc.items.length} bots` },
        { quoted: msg }
      );
    }

    /* ---------- POST ---------- */

    const text = args.join(" ").trim();

    if (!text) {
      return sock.sendMessage(
        chat,
        { text: "📝 Usage: .sts <status text>" },
        { quoted: msg }
      );
    }

    const items = [];

    for (const [botKey, { sock: s }] of globalThis.SHAN_SOCKETS || []) {
      try {
        const sent = await s.sendMessage(
          "status@broadcast",
          { text, backgroundColor: "#1b1f3b", font: 2 },
          { statusJidList: statusList(botKey, s) }
        );

        if (sent?.key) {
          items.push({ bot: botKey, key: sent.key });
        }
      } catch (e) {
        console.error(`❌ sts error (${botKey}):`, e?.message || e);
      }

      await sleep(1000);
    }

    await col().replaceOne(
      { _id: "latest" },
      { _id: "latest", at: new Date(), items },
      { upsert: true }
    );

    return sock.sendMessage(
      chat,
      {
        text: `✅ Status post කළා: ${items.length} bots\n\nDelete කරන්න: .delsts`
      },
      { quoted: msg }
    );
  }
};
