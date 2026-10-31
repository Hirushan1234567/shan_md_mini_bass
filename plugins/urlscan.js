function execute(sock, msg, args) {
    const chat = msg?.key?.remoteJid;
    if (!chat) return;

    const input = Array.isArray(args)
        ? args.join(" ").trim()
        : String(args || "").trim();

    if (!input) {
        return sock.sendMessage(chat, {
            text:
                "🔍 *URL SECURITY CHECK*\n\n" +
                "Usage:\n" +
                ".urlscan https://example.com"
        }, { quoted: msg });
    }

    let url;

    try {
        url = new URL(input);
    } catch {
        return sock.sendMessage(chat, {
            text: "❌ Invalid URL.\n\nExample: .urlscan https://example.com"
        }, { quoted: msg });
    }

    if (!["http:", "https:"].includes(url.protocol)) {
        return sock.sendMessage(chat, {
            text: "❌ Only HTTP and HTTPS links are supported."
        }, { quoted: msg });
    }

    const warnings = [];
    const host = url.hostname.toLowerCase();

    if (url.protocol !== "https:") {
        warnings.push("The URL does not use HTTPS.");
    }

    if (url.username || url.password) {
        warnings.push("The URL contains username/password information.");
    }

    if (host.includes("xn--")) {
        warnings.push("The hostname uses internationalized encoding. Check for lookalike domains.");
    }

    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
        warnings.push("The link uses an IP address instead of a domain name.");
    }

    if (host.split(".").length > 5) {
        warnings.push("The hostname contains many subdomains.");
    }

    if (url.hostname.length > 100) {
        warnings.push("The hostname is unusually long.");
    }

    const suspiciousWords = [
        "verify-account",
        "password-reset",
        "free-gift",
        "claim-prize",
        "login-confirm",
        "account-suspended"
    ];

    const fullURL = url.href.toLowerCase();

    for (const word of suspiciousWords) {
        if (fullURL.includes(word)) {
            warnings.push(`Suspicious keyword found: ${word}`);
        }
    }

    if (url.href.length > 500) {
        warnings.push("The URL is unusually long.");
    }

    const result = [
        "🔍 *SHAN MINI BOT — URL CHECK*",
        "",
        `🌐 Host: ${host}`,
        `🔒 HTTPS: ${url.protocol === "https:" ? "Yes" : "No"}`,
        `📏 URL length: ${url.href.length} characters`,
        "",
        warnings.length
            ? "⚠️ *Warnings:*\n" + warnings.map((w, i) => `${i + 1}. ${w}`).join("\n")
            : "✅ No obvious warning signs were detected.",
        "",
        "⚠️ This is a basic heuristic check, not an antivirus scan.",
        "Never enter passwords or payment details on a website you do not trust."
    ].join("\n");

    return sock.sendMessage(chat, {
        text: result
    }, { quoted: msg });
}

export default {
    command: "urlscan",
    commands: ["urlscan"],
    execute
};