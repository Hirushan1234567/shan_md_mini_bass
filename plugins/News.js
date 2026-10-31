// ═══════════════════════════════════════════════════════════
// SHAN MINI BOT V1 — SRI LANKA NEWS
// Dynamic Prefix + Auto Reaction
// Commands: news, slnews, lankanews
// ═══════════════════════════════════════════════════════════

export default {
    name: "news",

    commands: ["news", "slnews", "lankanews"],

    async execute(sock, msg, args) {
        const chat = msg.key.remoteJid;

        // React to command immediately
        try {
            await sock.sendMessage(chat, {
                react: {
                    text: "📰",
                    key: msg.key
                }
            });
        } catch (reactionError) {
            console.error("[NEWS REACTION ERROR]", reactionError);
        }

        try {
            // Fetch Sri Lanka news from Google News RSS
            const response = await fetch(
                "https://news.google.com/rss/search?q=Sri+Lanka&hl=en-US&gl=US&ceid=US:en",
                {
                    headers: {
                        "User-Agent": "Mozilla/5.0"
                    },
                    signal: AbortSignal.timeout(20000)
                }
            );

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const xml = await response.text();

            // Extract RSS items
            const items = [
                ...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)
            ];

            if (!items.length) {
                return await sock.sendMessage(
                    chat,
                    {
                        text: "❌ No news articles found. Please try again later."
                    },
                    { quoted: msg }
                );
            }

            // Decode XML entities
            function decodeXML(value = "") {
                return value
                    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
                    .replace(/&amp;/g, "&")
                    .replace(/&lt;/g, "<")
                    .replace(/&gt;/g, ">")
                    .replace(/&quot;/g, '"')
                    .replace(/&apos;/g, "'")
                    .replace(/&#39;/g, "'")
                    .replace(/&#(\d+);/g, (_, n) => {
                        try {
                            return String.fromCodePoint(Number(n));
                        } catch {
                            return _;
                        }
                    })
                    .replace(/&#x([0-9a-f]+);/gi, (_, n) => {
                        try {
                            return String.fromCodePoint(parseInt(n, 16));
                        } catch {
                            return _;
                        }
                    })
                    .trim();
            }

            // Get a tag value from an RSS item
            function getTag(item, tag) {
                const regex = new RegExp(
                    `<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`,
                    "i"
                );

                const match = item.match(regex);

                return match ? decodeXML(match[1]) : "";
            }

            // Prepare news articles
            const news = items
                .slice(0, 10)
                .map((item, index) => {
                    const content = item[1];

                    return {
                        number: index + 1,
                        title: getTag(content, "title"),
                        link: getTag(content, "link"),
                        date: getTag(content, "pubDate"),
                        source: getTag(content, "source")
                    };
                })
                .filter(item => item.title && item.link);

            if (!news.length) {
                return await sock.sendMessage(
                    chat,
                    {
                        text: "❌ Unable to read news articles. Please try again later."
                    },
                    { quoted: msg }
                );
            }

            // Build news message
            let output =
                "╭━━━〔 🇱🇰 SRI LANKA NEWS 〕━━━╮\n\n";

            for (const item of news) {
                output += `📰 *${item.number}. ${item.title}*\n`;

                if (item.source) {
                    output += `🏢 Source: ${item.source}\n`;
                }

                if (item.date) {
                    const published = new Date(item.date);

                    if (!Number.isNaN(published.getTime())) {
                        output += `🕒 ${published.toLocaleString("en-GB", {
                            timeZone: "Asia/Colombo"
                        })}\n`;
                    }
                }

                output += `🔗 ${item.link}\n\n`;
            }

            output += "╰━━━━━━━━━━━━━━━━━━━━━━╯\n";
            output += "⚡ POWERED BY SHAN MINI BOT";

            await sock.sendMessage(
                chat,
                { text: output },
                { quoted: msg }
            );

        } catch (error) {
            console.error("[NEWS PLUGIN ERROR]", error);

            await sock.sendMessage(
                chat,
                {
                    text:
                        "❌ Failed to fetch news.\n\n" +
                        "Please check your internet connection and try again."
                },
                { quoted: msg }
            );
        }
    }
};