import Parser from "rss-parser";

const parser = new Parser();

export default {
  command: "technews",
  category: "news",
  description: "Get the latest technology news",

  async execute(sock, msg) {
    const jid = msg.key.remoteJid;

    try {
      const feed = await parser.parseURL(
        "https://feeds.arstechnica.com/arstechnica/technology-lab"
      );

      const articles = (feed.items || []).slice(0, 5);

      if (!articles.length) {
        throw new Error("No news available.");
      }

      let output = "📰 *LATEST TECH NEWS*\n\n";

      articles.forEach((article, index) => {
        output +=
          `${index + 1}. *${article.title || "Untitled"}*\n` +
          `${article.link || ""}\n\n`;
      });

      output += "🔗 Source: Ars Technica";

      await sock.sendMessage(jid, {
        text: output.trim()
      }, { quoted: msg });

    } catch (error) {
      console.error("[technews]", error.message);

      await sock.sendMessage(jid, {
        text: "❌ Unable to retrieve technology news right now."
      }, { quoted: msg });
    }
  }
};