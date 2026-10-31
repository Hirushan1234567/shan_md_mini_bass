// SHAN MINI BOT V1 — RANDOM FACTS
// ESM | Dynamic Prefix | Auto Reaction

export default {
    name: "fact",
    commands: ["fact", "facts", "randomfact"],

    async execute(sock, msg, args) {
        const chat = msg.key.remoteJid;

        try {
            await sock.sendMessage(chat, {
                react: { text: "🧠", key: msg.key }
            });
        } catch {}

        try {
            const response = await fetch(
                "https://uselessfacts.jsph.pl/api/v2/facts/random?language=en",
                { signal: AbortSignal.timeout(15000) }
            );

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();

            if (!data.text) {
                throw new Error("No fact returned");
            }

            await sock.sendMessage(
                chat,
                {
                    text:
                        "╭━━━〔 🧠 RANDOM FACT 〕━━━╮\n\n" +
                        `${data.text}\n\n` +
                        "╰━━━━━━━━━━━━━━━━━━━━━━╯\n" +
                        "⚡ POWERED BY SHAN MINI BOT"
                },
                { quoted: msg }
            );
        } catch (error) {
            console.error("[FACT ERROR]", error);

            await sock.sendMessage(
                chat,
                { text: "❌ Unable to fetch a fact. Please try again later." },
                { quoted: msg }
            );
        }
    }
};