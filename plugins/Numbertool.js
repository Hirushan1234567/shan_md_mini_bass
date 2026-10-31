const plugin = {
    command: "numbertools",
    commands: ["numbertools", "percent"],

    async execute(sock, msg, args) {
        const chat = msg?.key?.remoteJid;
        if (!chat) return;

        const input = Array.isArray(args)
            ? args.map(String)
            : String(args || "").split(/\s+/);

        const action = (input.shift() || "").toLowerCase();
        const values = input.map(Number);

        if (action === "percent") {
            const [percent, number] = values;

            if (
                values.length !== 2 ||
                !Number.isFinite(percent) ||
                !Number.isFinite(number)
            ) {
                return sock.sendMessage(chat, {
                    text: "Usage: .numbertools percent 15 200"
                }, { quoted: msg });
            }

            return sock.sendMessage(chat, {
                text: `🔢 ${percent}% of ${number} = ${(percent / 100 * number).toLocaleString()}`
            }, { quoted: msg });
        }

        if (action === "increase" || action === "decrease") {
            const [original, percent] = values;

            if (
                values.length !== 2 ||
                !values.every(Number.isFinite)
            ) {
                return sock.sendMessage(chat, {
                    text: `Usage: .numbertools ${action} 200 15`
                }, { quoted: msg });
            }

            const result = action === "increase"
                ? original * (1 + percent / 100)
                : original * (1 - percent / 100);

            return sock.sendMessage(chat, {
                text: `🔢 Original: ${original}\nPercentage: ${percent}%\nResult: ${result}`
            }, { quoted: msg });
        }

        if (action === "average") {
            if (
                values.length < 1 ||
                !values.every(Number.isFinite)
            ) {
                return sock.sendMessage(chat, {
                    text: "Usage: .numbertools average 10 20 30"
                }, { quoted: msg });
            }

            const average = values.reduce((a, b) => a + b, 0) / values.length;

            return sock.sendMessage(chat, {
                text: `🔢 Average: ${average}`
            }, { quoted: msg });
        }

        return sock.sendMessage(chat, {
            text:
                "🔢 *NUMBER TOOLS*\n\n" +
                ".numbertools percent 15 200\n" +
                ".numbertools increase 200 15\n" +
                ".numbertools decrease 200 15\n" +
                ".numbertools average 10 20 30"
        }, { quoted: msg });
    }
};

export default plugin;