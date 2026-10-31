const plugin = {
    command: "timetools",
    commands: ["timetools", "worldtime"],

    async execute(sock, msg, args) {
        const chat = msg?.key?.remoteJid;
        if (!chat) return;

        const action = String(args?.[0] || "now").toLowerCase();
        const zone = String(args?.[1] || "Asia/Colombo");

        if (action === "unix") {
            const seconds = Math.floor(Date.now() / 1000);

            return sock.sendMessage(chat, {
                text: `⏰ Unix timestamp\n\nSeconds: ${seconds}\nMilliseconds: ${Date.now()}`
            }, { quoted: msg });
        }

        if (action === "date") {
            const date = new Date();

            return sock.sendMessage(chat, {
                text: `📅 ISO Date: ${date.toISOString()}\nUTC: ${date.toUTCString()}`
            }, { quoted: msg });
        }

        try {
            const now = new Date();

            const formatted = new Intl.DateTimeFormat("en-GB", {
                timeZone: zone,
                dateStyle: "full",
                timeStyle: "long"
            }).format(now);

            return sock.sendMessage(chat, {
                text:
                    "⏰ *TIME TOOLS*\n\n" +
                    `🌍 Timezone: ${zone}\n` +
                    `📅 ${formatted}\n\n` +
                    ".timetools now Asia/Colombo\n" +
                    ".timetools unix\n" +
                    ".timetools date"
            }, { quoted: msg });

        } catch {
            return sock.sendMessage(chat, {
                text: "❌ Invalid timezone. Example: Asia/Colombo"
            }, { quoted: msg });
        }
    }
};

export default plugin;