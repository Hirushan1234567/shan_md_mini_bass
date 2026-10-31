const plugin = {
    command: "devtools",
    commands: ["devtools", "jsonformat", "urlencode", "urldecode"],

    async execute(sock, msg, args, commandName) {
        const chat = msg?.key?.remoteJid;
        if (!chat) return;

        const input = Array.isArray(args)
            ? args.join(" ").trim()
            : String(args || "").trim();

        const action = String(commandName || "devtools").toLowerCase();

        if (!input) {
            return sock.sendMessage(chat, {
                text:
                    "💻 *DEVELOPER TOOLS*\n\n" +
                    ".devtools json {\"name\":\"SHAN\"}\n" +
                    ".devtools encode hello world\n" +
                    ".devtools decode hello%20world"
            }, { quoted: msg });
        }

        const parts = input.split(/\s+/);
        const operation = parts.shift().toLowerCase();
        const value = parts.join(" ");

        try {
            if (operation === "json") {
                const parsed = JSON.parse(input.slice(4).trim());

                return sock.sendMessage(chat, {
                    text: JSON.stringify(parsed, null, 2).slice(0, 12000)
                }, { quoted: msg });
            }

            if (operation === "encode") {
                return sock.sendMessage(chat, {
                    text: encodeURIComponent(input.slice(7))
                }, { quoted: msg });
            }

            if (operation === "decode") {
                return sock.sendMessage(chat, {
                    text: decodeURIComponent(input.slice(7))
                }, { quoted: msg });
            }

            return sock.sendMessage(chat, {
                text: "Use: .devtools json {...}\n.devtools encode text\n.devtools decode encoded_text"
            }, { quoted: msg });

        } catch (error) {
            return sock.sendMessage(chat, {
                text: `❌ Invalid input: ${error.message}`
            }, { quoted: msg });
        }
    }
};

export default plugin;