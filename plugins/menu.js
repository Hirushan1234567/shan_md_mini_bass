import mongoose from "mongoose";
import fs from "fs";
import path from "path";

/* =====================================================
   SHAN MINI BOT V1 — BLUE NEON MENU
   Dynamic Prefix | Premium Commands | Number Replies
   .menu    → Main Menu
   .allmenu → All Commands
===================================================== */

const BOT_NAME = "SHAN MINI BOT V1";
const MENU_TIMEOUT = 5 * 60 * 1000;

const MENU_CACHE = new Map();

const PREMIUM_CACHE = {
  commands: [],
  expires: 0
};

/* =====================================================
   CATEGORY CONFIGURATION
===================================================== */

const CATEGORIES = [
  {
    id: "main",
    icon: "🏠",
    name: "MAIN COMMANDS",
    description: "Bot information and basic commands",
    items: [
      ["menu", "Display the main menu"],
      ["allmenu", "Display all commands"],
      ["alive", "Check bot status"],
      ["botinfo", "Bot information"],
      ["runtime", "Bot uptime"],
      ["ping", "Check response speed"],
      ["stats", "Bot statistics"],
      ["owner", "Owner contact"]
    ]
  },

  {
    id: "downloader",
    icon: "📥",
    name: "DOWNLOADERS",
    description: "Download media from supported platforms",
    items: [
      ["song <song>", "Download music"],
      ["play2 <song>", "Alternative music downloader"],
      ["yt <link>", "YouTube downloader"],
      ["ytsearch <song>", "Search YouTube"],
      ["tiktok <link>", "TikTok downloader"],
      ["fb <link>", "Facebook downloader"],
      ["ig <link>", "Instagram downloader"],
      ["apk <app>", "Search APK applications"],
      ["uptodown <app>", "Search applications"],
      ["forward <JID>", "Forward a replied message"],
      ["jid", "Get chat JID"],
      ["pin", "Pinterest video download"]
    ]
  },

  {
    id: "movies",
    icon: "🎬",
    name: "MOVIES & ANIME",
    description: "Movies, Sinhala cartoons and anime",
    items: [
      ["cinesubz <name>", "Search movies"],
      ["cinesubzinfo", "Movie information"],
      ["cinesubzdl", "Download selected movie"],
      ["cartoon <name>", "Search cartoons"],
      ["cartoonlist", "Browse cartoon list"],
      ["cartoonlk <name>", "Search Cartoons.lk"],
      ["cartoonlklist", "Browse Cartoons.lk categories"],
      ["movieinfo <IMDb ID>", "Movie information"],
      ["animeinfo <name>", "Search anime"]
    ]
  },

  {
    id: "group",
    icon: "👥",
    name: "GROUP MANAGEMENT",
    description: "Manage group members and settings",
    items: [
      ["groupinfo", "Group information"],
      ["admins", "List group admins"],
      ["tagadmin", "Tag group admins"],
      ["tagall", "Tag group members"],
      ["hidetag <text>", "Tag everyone invisibly"],
      ["promote @user", "Promote a member"],
      ["demote @user", "Demote an admin"],
      ["kick @user", "Remove a member"],
      ["add <number>", "Add a member"],
      ["open", "Open group chat"],
      ["close", "Close group chat"],
      ["subject <name>", "Change group subject"],
      ["desc <text>", "Change group description"],
      ["link", "Get group invite link"],
      ["revoke", "Reset group invite link"],
      ["leave", "Leave the group"],
      ["gset", "Group settings"],
      ["antilink on/off", "Anti-link protection"],
      ["warn @user", "Warn a member"],
      ["warns", "Check member warnings"],
      ["resetwarn @user", "Reset warnings"]
    ]
  },

  {
    id: "tools",
    icon: "🛠️",
    name: "SMART TOOLS",
    description: "Useful everyday tools",
    items: [
      ["weather <city>", "Weather information"],
      ["news", "Latest news"],
      ["translate <lang> <text>", "Translate text"],
      ["qr <text>", "Generate QR code"],
      ["qrreader", "Read QR from an image"],
      ["barcode <text>", "Generate barcode"],
      ["calendar", "Display calendar"],
      ["currency <amount> <from> <to>", "Currency conversion"],
      ["countryinfo <country>", "Country information"],
      ["dictionary <word>", "Dictionary"],
      ["calc <expression>", "Calculator"],
      ["shorturl <link>", "Shorten URL"],
      ["sltime", "Sri Lanka time"],
      ["dp", "Get profile picture"],
      ["sticker", "Convert media to sticker"]
    ]
  },

  {
    id: "internet",
    icon: "🌐",
    name: "INTERNET & TECHNOLOGY",
    description: "Technology information and service status",
    items: [
      ["githubstatus", "GitHub service status"],
      ["technews", "Technology news"]
    ]
  },

  {
    id: "music",
    icon: "🎵",
    name: "MUSIC",
    description: "Music and lyrics",
    items: [
      ["lyrics <song>", "Search song lyrics"],
      ["chsong <channel> <song>", "Send song to channel"]
    ]
  },

  {
    id: "fun",
    icon: "🎮",
    name: "FUN & GAMES",
    description: "Games and entertainment",
    items: [
      ["fact", "Random fact"],
      ["coin", "Flip a coin"],
      ["dice", "Roll a dice"],
      ["choose a | b | c", "Choose a random option"],
      ["8ball <question>", "Magic 8-ball"],
      ["truth", "Truth question"],
      ["dare", "Dare challenge"]
    ]
  },

  {
    id: "ai",
    icon: "🤖",
    name: "AI ASSISTANT",
    description: "Artificial intelligence",
    items: [
      ["ai <question>", "Ask the AI assistant"]
    ]
  },

  {
    id: "premium",
    icon: "💎",
    name: "PREMIUM",
    description: "Premium-only commands",
    items: []
  },

  {
    id: "admin",
    icon: "🛡️",
    name: "ADMIN & OWNER",
    description: "Bot administration",
    items: [
      ["settings", "Bot settings"],
      ["broadcast <text>", "Broadcast a message"],
      ["botadmin", "Manage bot administrators"],
      ["admininfo <number>", "Admin information"],
      ["adminlogs", "Admin logs"],
      ["adminblock <number>", "Block bot access"],
      ["adminunblock <number>", "Unblock bot access"],
      ["addpremium <number>", "Grant Premium"],
      ["extendpremium <number>", "Extend Premium"],
      ["delpremium <number>", "Remove Premium"],
      ["premiuminfo <number>", "Premium information"],
      ["premiumlist", "List Premium users"],
      ["mypremium", "Check your Premium status"],
      ["premiumco <command>", "Enable Premium-only command"],
      ["unpremiumco <command>", "Remove Premium restriction"],
      ["premiumcolist", "List Premium-only commands"],
      ["pair <number>", "Pair WhatsApp number"],
      ["unpair <number>", "Unpair session"],
      ["pairlist", "List paired sessions"]
    ]
  }
];

/* =====================================================
   DYNAMIC PREFIX
===================================================== */

function getPrefix() {
  try {
    if (typeof globalThis.SHAN_GET_SETTINGS === "function") {
      const settings = globalThis.SHAN_GET_SETTINGS();

      if (settings?.prefix) {
        return String(settings.prefix);
      }
    }

    if (globalThis.SHAN_SETTINGS?.prefix) {
      return String(globalThis.SHAN_SETTINGS.prefix);
    }
  } catch (error) {
    console.error("[MENU] Prefix error:", error.message);
  }

  return process.env.PREFIX || ".";
}

/* =====================================================
   PREMIUM COMMANDS
===================================================== */

async function getPremiumOnlyCommands() {
  if (Date.now() < PREMIUM_CACHE.expires) {
    return PREMIUM_CACHE.commands;
  }

  try {
    if (mongoose.connection.readyState !== 1) {
      return PREMIUM_CACHE.commands;
    }

    const collection = mongoose.connection.db.collection(
      "premiumsettings"
    );

    const document = await collection.findOne({
      _id: "premium_commands"
    });

    let commands = document?.commands || [];

    if (commands instanceof Set) {
      commands = [...commands];
    }

    if (typeof commands === "string") {
      commands = commands
        .split(/[\s,]+/)
        .filter(Boolean);
    }

    if (!Array.isArray(commands)) {
      commands = [];
    }

    PREMIUM_CACHE.commands = [
      ...new Set(
        commands
          .map(command =>
            String(command)
              .trim()
              .replace(/^[.!#$%^&*+=?/-]+/, "")
              .split(/\s+/)[0]
              .toLowerCase()
          )
          .filter(Boolean)
      )
    ];

    PREMIUM_CACHE.expires = Date.now() + 30_000;

    return PREMIUM_CACHE.commands;

  } catch (error) {
    console.error("[MENU] Premium commands:", error.message);
    return PREMIUM_CACHE.commands;
  }
}

/* =====================================================
   FORMAT
===================================================== */

function line() {
  return "╰━━━━━━━━━━━━━━━━━━╯";
}

function header(title) {
  return [
    "╭━━━━━━━━━━━━━━━━━━╮",
    "┃ 💠 *SHAN MINI BOT*",
    `┃ ⚡ *${title}*`,
    line()
  ].join("\n");
}

function formatCommand(prefix, command, description) {
  return `┃ ${prefix}${command}\n┃ ↳ ${description}`;
}

/* =====================================================
   MAIN MENU
===================================================== */

async function buildMainMenu() {
  const prefix = getPrefix();

  const rows = [
    header("BLUE NEON MENU"),
    "┃ 🤖 Version: *V1*",
    `┃ ⚡ Prefix: *${prefix}*`,
    `┃ 📚 Categories: *${CATEGORIES.length}*`,
    "╰━━━━━━━━━━━━━━━━━━╯",
    "",
    "╭━━━━━━ *CATEGORIES* ━━━━━━╮"
  ];

  CATEGORIES.forEach((category, index) => {
    rows.push(
      `┃ ${String(index + 1).padStart(2, "0")}. ${category.icon} *${category.name}*`
    );
  });

  rows.push(
    "╰━━━━━━━━━━━━━━━━━━╯",
    "",
    "╭━━━━━━━━━━━━━━━━━━╮",
    "┃ 🔢 Reply with a category number",
    "┃ 📋 Reply *0* to view all commands",
    `┃ 💠 Use *${prefix}allmenu* for all commands`,
    "┃ 💠 Blue Neon • SHAN MINI BOT V1",
    line()
  );

  return rows.join("\n");
}

/* =====================================================
   CATEGORY MENU
===================================================== */

async function buildCategory(category) {
  const prefix = getPrefix();

  let items = [...category.items];

  if (category.id === "premium") {
    const premiumCommands = await getPremiumOnlyCommands();

    items = premiumCommands.map(command => [
      command,
      "Premium-only command"
    ]);
  }

  const rows = [
    header(category.name),
    `┃ ${category.icon} ${category.description}`,
    `┃ 📦 Commands: *${items.length}*`,
    line(),
    ""
  ];

  if (!items.length) {
    rows.push(
      "┃ No commands are configured here yet.",
      ""
    );
  } else {
    for (const [command, description] of items) {
      rows.push(
        formatCommand(prefix, command, description),
        ""
      );
    }
  }

  rows.push(
    line(),
    `┃ Reply *${CATEGORIES.findIndex(c => c.id === category.id) + 1}* to reopen this category`,
    "┃ Reply *0* for all commands",
    `┃ Reply *${prefix}menu* for main menu`,
    line()
  );

  return rows.join("\n");
}

/* =====================================================
   ALL COMMANDS
===================================================== */

async function buildAllMenu() {
  const prefix = getPrefix();

  const rows = [
    header("ALL COMMANDS"),
    `┃ ⚡ Prefix: *${prefix}*`,
    `┃ 📚 Categories: *${CATEGORIES.length}*`,
    ""
  ];

  for (const category of CATEGORIES) {
    let items = [...category.items];

    if (category.id === "premium") {
      const premiumCommands = await getPremiumOnlyCommands();

      items = premiumCommands.map(command => [
        command,
        "Premium-only command"
      ]);
    }

    rows.push(
      `${category.icon} *${category.name}*`,
      `┃ ${category.description}`,
      line()
    );

    if (!items.length) {
      rows.push("┃ No commands configured", "");
      continue;
    }

    for (const [command, description] of items) {
      rows.push(
        formatCommand(prefix, command, description)
      );
    }

    rows.push("");
  }

  rows.push(
    line(),
    "┃ 💠 SHAN MINI BOT V1",
    "┃ ⚡ Blue Neon Edition",
    `┃ ⚡ Prefix: *${prefix}*`,
    line()
  );

  return rows.join("\n");
}

/* =====================================================
   MENU MESSAGE CACHE
===================================================== */

function cleanupCache() {
  const now = Date.now();

  for (const [key, value] of MENU_CACHE.entries()) {
    if (now - value.time > MENU_TIMEOUT) {
      MENU_CACHE.delete(key);
    }
  }
}

/* =====================================================
   SEND MENU
===================================================== */

async function sendMenu(sock, msg, text) {
  const jid =
    msg.key?.remoteJid ||
    msg.remoteJid;

  const root = process.cwd();
  const logoPath = path.join(root, "logo.jpg");

  let sent;

  try {
    const isMainCategoryMenu = text.includes("CATEGORIES") && !text.includes("ALL COMMANDS");
    if (isMainCategoryMenu) {
      const sections = [{
        title: "📚 Select a category",
        rows: [
          ...CATEGORIES.map(category => ({
            title: `${category.icon} ${category.name}`,
            rowId: `shan_category_${category.id}`,
            description: category.description
          })),
          { title: "📋 All commands", rowId: "shan_category_all", description: "Show every command" }
        ]
      }];
      sent = await sock.sendMessage(
        jid,
        { text, title: "SHAN MINI BOT", footer: "💠 Blue Neon Edition", buttonText: "⚡ Open categories", sections },
        { quoted: msg }
      );
    } else if (fs.existsSync(logoPath)) {
      sent = await sock.sendMessage(jid, { image: fs.readFileSync(logoPath), caption: text }, { quoted: msg });
    } else {
      sent = await sock.sendMessage(jid, { text }, { quoted: msg });
    }
  } catch (error) {
    console.error("[MENU] Image send failed:", error.message);

    sent = await sock.sendMessage(
      jid,
      { text },
      { quoted: msg }
    );
  }

  if (sent?.key?.id) {
    cleanupCache();

    MENU_CACHE.set(sent.key.id, {
      time: Date.now(),
      jid
    });
  }

  return sent;
}

/* =====================================================
   REPLY HANDLER
===================================================== */

async function handleReply(sock, msg, text) {
  const quoted =
    msg.message?.extendedTextMessage?.contextInfo;

  const quotedId = quoted?.stanzaId;

  if (!quotedId || !MENU_CACHE.has(quotedId)) {
    return false;
  }

  const cached = MENU_CACHE.get(quotedId);

  if (Date.now() - cached.time > MENU_TIMEOUT) {
    MENU_CACHE.delete(quotedId);
    return false;
  }

  const input = String(text || "")
    .trim()
    .toLowerCase();

  if (input.startsWith("shan_category_")) {
    const selected = input.slice("shan_category_".length);
    if (selected === "all") {
      await sendMenu(sock, msg, await buildAllMenu());
      return true;
    }
    const category = CATEGORIES.find(item => item.id === selected);
    if (category) {
      await sendMenu(sock, msg, await buildCategory(category));
      return true;
    }
  }

  if (input === "menu" || input === "help") {
    await sendMenu(
      sock,
      msg,
      await buildMainMenu()
    );

    return true;
  }

  if (input === "0" || input === "all") {
    await sendMenu(
      sock,
      msg,
      await buildAllMenu()
    );

    return true;
  }

  if (/^\d{1,2}$/.test(input)) {
    const number = Number(input);

    if (
      number >= 1 &&
      number <= CATEGORIES.length
    ) {
      await sendMenu(
        sock,
        msg,
        await buildCategory(CATEGORIES[number - 1])
      );

      return true;
    }
  }

  return false;
}

/* =====================================================
   PLUGIN EXPORT
===================================================== */

const menuPlugin = {
  name: "menu",

  command: [
    "menu",
    "help",
    "allmenu",
    "list"
  ],

  category: "main",

  description: "Blue Neon category menu",

  usage: ".menu",

  react: "💠",

  async execute(sock, msg, args, commandName) {
    const selectedCommand = String(
      commandName || ""
    )
      .toLowerCase()
      .trim();

    // .allmenu → Display all categories and commands
    if (selectedCommand === "allmenu") {
      const text = await buildAllMenu();

      return sendMenu(sock, msg, text);
    }

    // .menu / .help / .list → Main menu
    const text = await buildMainMenu();

    return sendMenu(sock, msg, text);
  },

  replyHandler: true,

  async handleReply(sock, msg, text) {
    return handleReply(sock, msg, text);
  }
};

export default menuPlugin;