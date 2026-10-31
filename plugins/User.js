// ============================================================
// SHAN MINI BOT V1 — USERS MANAGEMENT
// BLUE NEON EDITION
//
// .users
// .users online
// .users offline
// .users <number>
//
// Owner Only
// Compatible with your current index.js
// ============================================================

const cleanNum = (value) =>
  String(value || "")
    .split("@")[0]
    .split(":")[0]
    .replace(/\D/g, "");

// ============================================================
// GET USERS FROM SOCKET REGISTRY
// ============================================================

function getUsers() {
  const sockets = globalThis.SHAN_SOCKETS;

  if (!(sockets instanceof Map)) {
    throw new Error("SHAN_SOCKETS not initialized.");
  }

  const users = [];

  for (const [key, session] of sockets.entries()) {
    const sock = session?.sock;

    if (!sock) continue;

    const number = cleanNum(
      key === "main"
        ? sock.user?.id
        : key
    );

    if (!number) continue;

    users.push({
      number,
      online: Boolean(sock.user),
      type: session.sub ? "Sub Bot" : "Main Bot"
    });
  }

  return users;
}

// ============================================================
// FORMAT USER LIST
// ============================================================

function formatUsers(title, list) {
  let text = `╭━━〔 💙 ${title} 〕━━╮\n\n`;

  list.forEach((user, index) => {
    text +=
      `${index + 1}. ${user.online ? "🟢" : "🔴"} ` +
      `+${user.number}\n` +
      `   🤖 ${user.type}\n\n`;
  });

  text += "╰━━━━━━━━━━━━━━━━━━━━╯";

  return text;
}

// ============================================================
// USERS PLUGIN
// ============================================================

const usersCommand = {

  // IMPORTANT:
  // Your index.js reads command, commands and alias.
  command: "users",

  alias: [
    "connected",
    "userlist"
  ],

  async run({ sock, m, args, config }) {

    // ========================================================
    // OWNER CHECK
    // ========================================================

    const isOwner = globalThis.SHAN_IS_OWNER_MSG;

    if (
      typeof isOwner !== "function" ||
      !isOwner(m)
    ) {
      return m.reply("❌ This command is available to the main owner only.");
    }

    try {

      const users = getUsers();

      const online = users.filter(user => user.online);
      const offline = users.filter(user => !user.online);

      const query = String(args?.[0] || "")
        .trim()
        .toLowerCase();

      // ======================================================
      // ONLINE USERS
      // ======================================================

      if (query === "online") {

        if (!online.length) {
          return m.reply(
            "╭━━〔 🟢 ONLINE USERS 〕━━╮\n\n" +
            "No online sessions found.\n\n" +
            "╰━━━━━━━━━━━━━━━━━━━━╯"
          );
        }

        return m.reply(
          formatUsers("ONLINE USERS", online)
        );
      }

      // ======================================================
      // OFFLINE USERS
      // ======================================================

      if (query === "offline") {

        return m.reply(
          "🔴 *OFFLINE SESSIONS*\n\n" +
          `Offline sessions: ${offline.length}\n\n` +
          "⚠️ The current SHAN_SOCKETS registry only stores active " +
          "sockets. Disconnected sessions are removed from it.\n\n" +
          "A persistent session database is required to list all offline users."
        );
      }

      // ======================================================
      // SEARCH USER
      // ======================================================

      if (query) {

        const number = cleanNum(query);

        if (!number) {
          return m.reply("❌ Please enter a valid phone number.");
        }

        const found = users.find(
          user => user.number === number
        );

        if (!found) {
          return m.reply(
            `❌ Session not found: +${number}\n\n` +
            "This number is not currently registered in SHAN_SOCKETS."
          );
        }

        return m.reply(
          "╭━━〔 👤 USER DETAILS 〕━━╮\n\n" +
          `📱 Number: +${found.number}\n` +
          `📡 Status: ${found.online ? "🟢 Online" : "🔴 Offline"}\n` +
          `🤖 Type: ${found.type}\n\n` +
          "╰━━━━━━━━━━━━━━━━━━━━╯"
        );
      }

      // ======================================================
      // ALL USERS
      // ======================================================

      let text =
        "╭━━〔 💙 SHAN MINI BOT V1 〕━━╮\n\n" +
        "📊 *SESSION STATISTICS*\n\n" +
        `👥 Total Sessions: ${users.length}\n` +
        `🟢 Online: ${online.length}\n` +
        `🔴 Offline: ${offline.length}\n\n` +
        "📋 *CONNECTED SESSIONS*\n\n";

      if (users.length) {

        users.forEach((user, index) => {

          text +=
            `${index + 1}. ${user.online ? "🟢" : "🔴"} ` +
            `+${user.number}\n` +
            `   🤖 ${user.type}\n\n`;

        });

      } else {

        text += "No sessions found.\n";

      }

      text +=
        "╰━━━━━━━━━━━━━━━━━━━━╯";

      return m.reply(text);

    } catch (error) {

      console.error("[USERS PLUGIN ERROR]", error);

      return m.reply(
        "❌ Unable to retrieve users.\n\n" +
        `Error: ${error?.message || error}`
      );

    }
  }
};

export default usersCommand;