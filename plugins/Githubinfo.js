import axios from "axios";

export default {
  command: "githubstatus",
  category: "utility",
  description: "Check GitHub service status",

  async execute(sock, msg) {
    const jid = msg.key.remoteJid;

    try {
      const response = await axios.get(
        "https://www.githubstatus.com/api/v2/status.json",
        { timeout: 15000 }
      );

      const status = response.data.status;

      await sock.sendMessage(jid, {
        text:
          "🐙 *GITHUB STATUS*\n\n" +
          `📊 Status: ${status.description}\n` +
          `🟢 Indicator: ${status.indicator}\n\n` +
          "🔗 Source: githubstatus.com"
      }, { quoted: msg });

    } catch (error) {
      console.error("[githubstatus]", error.message);

      await sock.sendMessage(jid, {
        text: "❌ Unable to retrieve GitHub status right now."
      }, { quoted: msg });
    }
  }
};