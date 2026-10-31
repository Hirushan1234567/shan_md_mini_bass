import axios from "axios";

export default {
  command: "animeinfo",
  category: "search",
  description: "Search for anime information",

  async execute(sock, msg, args) {
    const jid = msg.key.remoteJid;

    try {
      const title = args.join(" ").trim();

      if (!title) {
        return sock.sendMessage(jid, {
          text: "Usage: .animeinfo <anime name>\nExample: .animeinfo Naruto"
        }, { quoted: msg });
      }

      const response = await axios.get(
        "https://api.jikan.moe/v4/anime",
        {
          params: {
            q: title,
            limit: 1
          },
          timeout: 20000
        }
      );

      const anime = response.data.data?.[0];

      if (!anime) {
        return sock.sendMessage(jid, {
          text: "❌ Anime not found."
        }, { quoted: msg });
      }

      await sock.sendMessage(jid, {
        text:
          "🍥 *ANIME INFORMATION*\n\n" +
          `📺 Title: ${anime.title}\n` +
          `🇯🇵 Japanese: ${anime.title_japanese || "N/A"}\n` +
          `📅 Year: ${anime.year || "N/A"}\n` +
          `🎭 Type: ${anime.type || "N/A"}\n` +
          `📚 Episodes: ${anime.episodes ?? "Unknown"}\n` +
          `⭐ Score: ${anime.score ?? "N/A"}\n` +
          `📊 Status: ${anime.status || "N/A"}\n\n` +
          `📖 Synopsis:\n${anime.synopsis || "No synopsis available."}\n\n` +
          `🔗 More Info: ${anime.url}`
      }, { quoted: msg });

    } catch (error) {
      console.error("[animeinfo]", error.message);

      await sock.sendMessage(jid, {
        text: "❌ Unable to retrieve anime information."
      }, { quoted: msg });
    }
  }
};