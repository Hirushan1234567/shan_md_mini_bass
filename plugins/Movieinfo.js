import axios from "axios";

export default {
  command: "movieinfo",
  aliases: ["imdbinfo", "film"],
  category: "search",
  description: "Get movie information without an API key",

  async execute(sock, msg, args) {
    const jid = msg.key.remoteJid;

    try {
      const query = args.join(" ").trim();

      if (!query) {
        return await sock.sendMessage(
          jid,
          {
            text:
              "🎬 *MOVIE INFORMATION*\n\n" +
              "Usage: .movieinfo <IMDb ID>\n\n" +
              "Example:\n" +
              ".movieinfo tt0133093\n\n" +
              "Note: This version searches using IMDb IDs."
          },
          { quoted: msg }
        );
      }

      if (!/^tt\d{5,12}$/i.test(query)) {
        return await sock.sendMessage(
          jid,
          {
            text:
              "❌ Please provide a valid IMDb ID.\n\n" +
              "Example: .movieinfo tt0133093"
          },
          { quoted: msg }
        );
      }

      await sock.sendMessage(
        jid,
        { text: "🔎 Searching for movie information..." },
        { quoted: msg }
      );

      const response = await axios.get(
        `https://cinemeta-live.strem.io/meta/movie/${query.toLowerCase()}.json`,
        {
          timeout: 20000,
          headers: {
            Accept: "application/json"
          }
        }
      );

      const movie = response.data?.meta;

      if (!movie || !movie.name) {
        return await sock.sendMessage(
          jid,
          { text: "❌ Movie information was not found." },
          { quoted: msg }
        );
      }

      const genres = Array.isArray(movie.genre)
        ? movie.genre.join(", ")
        : "Not available";

      const cast = Array.isArray(movie.cast)
        ? movie.cast.slice(0, 5).join(", ")
        : "Not available";

      const directors = Array.isArray(movie.director)
        ? movie.director.join(", ")
        : "Not available";

      const description = movie.description || "No description available.";

      const text =
        "╭━━━〔 🎬 MOVIE INFORMATION 〕━━━╮\n\n" +
        `🎞️ *Title:* ${movie.name}\n` +
        `🆔 *IMDb ID:* ${movie.imdb_id || query}\n` +
        `📅 *Released:* ${movie.releaseInfo || "Unknown"}\n` +
        `⭐ *Rating:* ${movie.imdbRating || "N/A"}\n` +
        `🎭 *Genres:* ${genres}\n` +
        `🎬 *Director:* ${directors}\n` +
        `👥 *Cast:* ${cast}\n\n` +
        `📖 *Description:*\n${description.slice(0, 1200)}\n\n` +
        "╰━━━━━━━━━━━━━━━━━━━━╯";

      const poster = movie.poster;

      if (poster && /^https?:\/\//i.test(poster)) {
        await sock.sendMessage(
          jid,
          {
            image: { url: poster },
            caption: text
          },
          { quoted: msg }
        );
      } else {
        await sock.sendMessage(
          jid,
          { text },
          { quoted: msg }
        );
      }
    } catch (error) {
      console.error("[movieinfo]", error.message);

      await sock.sendMessage(
        jid,
        {
          text:
            "❌ Unable to retrieve movie information.\n\n" +
            "The service may be temporarily unavailable. Please try again later."
        },
        { quoted: msg }
      );
    }
  }
};