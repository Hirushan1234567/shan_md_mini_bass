import crypto from "crypto";

export default {
  command: "password",
  aliases: ["genpass", "passgen"],
  category: "utility",
  description: "Generate a secure random password",

  async execute(sock, msg, args) {
    const jid = msg.key.remoteJid;

    try {
      const requestedLength = args?.[0]
        ? Number(args[0])
        : 16;

      if (
        !Number.isInteger(requestedLength) ||
        requestedLength < 8 ||
        requestedLength > 64
      ) {
        return await sock.sendMessage(
          jid,
          {
            text:
              "❌ Invalid password length!\n\n" +
              "Password length must be between 8 and 64 characters.\n\n" +
              "📌 *Examples:*\n" +
              ".password\n" +
              ".password 20\n" +
              ".password 32"
          },
          { quoted: msg }
        );
      }

      const length = requestedLength;

      const lowercase = "abcdefghijklmnopqrstuvwxyz";
      const uppercase = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
      const numbers = "0123456789";
      const symbols = "!@#$%^&*_-+=";

      const all = lowercase + uppercase + numbers + symbols;

      function secureChar(charset) {
        const limit =
          Math.floor(256 / charset.length) * charset.length;

        let byte;

        do {
          byte = crypto.randomBytes(1)[0];
        } while (byte >= limit);

        return charset[byte % charset.length];
      }

      const chars = [
        secureChar(lowercase),
        secureChar(uppercase),
        secureChar(numbers),
        secureChar(symbols)
      ];

      while (chars.length < length) {
        chars.push(secureChar(all));
      }

      // Securely shuffle the password characters.
      for (let i = chars.length - 1; i > 0; i--) {
        const j = crypto.randomInt(i + 1);

        [chars[i], chars[j]] = [chars[j], chars[i]];
      }

      const password = chars.join("");

      await sock.sendMessage(
        jid,
        {
          text:
            "╭━━━〔 🔐 PASSWORD GENERATOR 〕━━━╮\n\n" +
            `🔑 *Password:*\n${password}\n\n` +
            `📏 *Length:* ${length} characters\n` +
            "🛡️ *Security:* Cryptographically random\n\n" +
            "⚠️ Store your password securely.\n" +
            "╰━━━━━━━━━━━━━━━━━━━━╯"
        },
        { quoted: msg }
      );

    } catch (error) {
      console.error("[password]", error.message);

      await sock.sendMessage(
        jid,
        {
          text:
            "❌ Failed to generate a password.\n" +
            "Please try again."
        },
        { quoted: msg }
      );
    }
  }
};