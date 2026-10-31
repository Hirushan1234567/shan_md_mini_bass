import axios from "axios";

export default {
  command: "shorturl",
  aliases: ["tinyurl", "shortlink"],
  category: "utility",
  description: "Shorten a long URL",

  async execute(sock, msg, args) {
    const jid = msg.key.remoteJid;

    try {
      const input = args.join(" ").trim();

      if (!input) {
        return await sock.sendMessage(
          jid,
          {
            text:
              "🔗 *URL SHORTENER*\n\n" +
              "Usage:\n" +
              ".shorturl https://example.com"
          },
          { quoted: msg }
        );
      }

      let url;

      try {
        url = new URL(input);
      } catch {
        return await sock.sendMessage(
          jid,
          {
            text:
              "❌ Invalid URL!\n\n" +
              "Please provide a valid website URL."
          },
          { quoted: msg }
        );
      }

      if (!["http:", "https:"].includes(url.protocol)) {
        return await sock.sendMessage(
          jid,
          {
            text: "❌ Only HTTP and HTTPS URLs are supported."
          },
          { quoted: msg }
        );
      }

      await sock.sendMessage(
        jid,
        { text: "⏳ Shortening your URL..." },
        { quoted: msg }
      );

      const response = await axios.get(
        "https://tinyurl.com/api-create.php",
        {
          params: { url: url.href },
          timeout: 15000,
          responseType: "text",
          transformResponse: [(data) => data]
        }
      );

      const shortUrl = String(response.data).trim();

      if (
        response.status !== 200 ||
        !/^https:\/\/tinyurl\.com\/[a-zA-Z0-9_-]+$/.test(shortUrl)
      ) {
        throw new Error("Invalid response from shortening service.");
      }

      await sock.sendMessage(
        jid,
        {
          text:
            "╭━━━〔 🔗 URL SHORTENER 〕━━━╮\n\n" +
            `📎 *Original URL:*\n${url.href}\n\n` +
            `✨ *Short URL:*\n${shortUrl}\n\n` +
            "╰━━━━━━━━━━━━━━━━━━━━╯"
        },
        { quoted: msg }
      );

    } catch (error) {
      console.error("[shorturl]", error.message);

      await sock.sendMessage(
        jid,
        {
          text:
            "❌ Failed to shorten the URL.\n" +
            "Please try again later."
        },
        { quoted: msg }
      );
    }
  }
};