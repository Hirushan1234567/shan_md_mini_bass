import crypto from "node:crypto";

function calculate(expression) {
  const input = expression.replace(/\s+/g, "");

  if (!input || input.length > 100) {
    throw new Error("Invalid expression.");
  }

  const tokens = input.match(/\d+(?:\.\d+)?|[()+\-*/%]/g);

  if (!tokens || tokens.join("") !== input) {
    throw new Error("Invalid mathematical expression.");
  }

  let pos = 0;

  function primary() {
    const token = tokens[pos++];

    if (token === "+") return primary();
    if (token === "-") return -primary();

    if (token === "(") {
      const value = addSub();
      if (tokens[pos++] !== ")") throw new Error("Mismatched brackets.");
      return value;
    }

    if (/^\d/.test(token || "")) return Number(token);

    throw new Error("Invalid expression.");
  }

  function mulDiv() {
    let value = primary();

    while (["*", "/", "%"].includes(tokens[pos])) {
      const op = tokens[pos++];
      const right = primary();

      if ((op === "/" || op === "%") && right === 0) {
        throw new Error("Division by zero is not allowed.");
      }

      if (op === "*") value *= right;
      if (op === "/") value /= right;
      if (op === "%") value %= right;
    }

    return value;
  }

  function addSub() {
    let value = mulDiv();

    while (["+", "-"].includes(tokens[pos])) {
      const op = tokens[pos++];
      const right = mulDiv();
      value = op === "+" ? value + right : value - right;
    }

    return value;
  }

  const result = addSub();

  if (pos !== tokens.length || !Number.isFinite(result)) {
    throw new Error("Invalid calculation.");
  }

  return Number(result.toPrecision(12));
}

function generatePassword(length = 16) {
  const chars =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*";

  const password = [];
  const bytes = crypto.randomBytes(length);

  for (let i = 0; i < length; i++) {
    password.push(chars[bytes[i] % chars.length]);
  }

  return password.join("");
}

function getQuotedText(msg) {
  const quoted =
    msg?.message?.extendedTextMessage?.contextInfo?.quotedMessage;

  return (
    quoted?.conversation ||
    quoted?.extendedTextMessage?.text ||
    quoted?.imageMessage?.caption ||
    quoted?.videoMessage?.caption ||
    ""
  ).trim();
}

export default {
  command: "utility",

  commands: [
    "utility",
    "text",
    "base64",
    "json",
    "calc",
    "password",
    "bmi",
    "age",
    "unix",
    "devmenu"
  ],

  alias: [
    "text",
    "base64",
    "json",
    "calc",
    "password",
    "bmi",
    "age",
    "unix",
    "devmenu"
  ],

  description: "Useful everyday utility tools",
  category: "tools",
  react: "🛠️",

  async execute(sock, msg, args, commandName) {
    const from = msg?.key?.remoteJid;
    if (!from) return;

    const reply = text =>
      sock.sendMessage(from, { text: String(text) }, { quoted: msg });

    const cmd = String(commandName || "utility").toLowerCase();
    const input = (Array.isArray(args) ? args : []).join(" ").trim();
    const [sub, ...remaining] = input.split(/\s+/);
    const action = (sub || "").toLowerCase();
    const rest = remaining.join(" ");

    try {
      if (cmd === "utility" || cmd === "devmenu") {
        return reply(
          "╭━━〔 💙 SHAN UTILITY 〕━━╮\n" +
          "┃ .text count <text>\n" +
          "┃ .text upper <text>\n" +
          "┃ .text lower <text>\n" +
          "┃ .text reverse <text>\n" +
          "┃ .text clean <text>\n" +
          "┃ .base64 encode <text>\n" +
          "┃ .base64 decode <text>\n" +
          "┃ .json <json>\n" +
          "┃ .calc <expression>\n" +
          "┃ .password [length]\n" +
          "┃ .bmi <kg> <height_cm>\n" +
          "┃ .age <YYYY-MM-DD>\n" +
          "┃ .unix <timestamp>\n" +
          "╰━━━━━━━━━━━━━━━━━━╯"
        );
      }

      if (cmd === "text") {
        const text = rest || getQuotedText(msg);

        if (!text) {
          return reply("Usage: .text count <text>");
        }

        switch (action) {
          case "count":
            return reply(
              `WORDS: ${text.trim().split(/\s+/).length}\n` +
              `CHARACTERS: ${[...text].length}\n` +
              `NO SPACES: ${text.replace(/\s/g, "").length}\n` +
              `LINES: ${text.split(/\r\n|\r|\n/).length}`
            );

          case "upper":
            return reply(text.toUpperCase());

          case "lower":
            return reply(text.toLowerCase());

          case "reverse":
            return reply([...text].reverse().join(""));

          case "clean":
            return reply(text.replace(/\s+/g, " ").trim());

          default:
            return reply(
              "Available actions: count, upper, lower, reverse, clean"
            );
        }
      }

      if (cmd === "base64") {
        const text = rest || getQuotedText(msg);

        if (!text) {
          return reply(
            "Usage:\n.base64 encode <text>\n.base64 decode <text>"
          );
        }

        if (action === "encode") {
          return reply(Buffer.from(text, "utf8").toString("base64"));
        }

        if (action === "decode") {
          if (
            !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text)
          ) {
            return reply("Invalid Base64 input.");
          }

          return reply(Buffer.from(text, "base64").toString("utf8"));
        }

        return reply("Usage: .base64 encode/decode <text>");
      }

      if (cmd === "json") {
        const text = input || getQuotedText(msg);
        if (!text) return reply('Usage: .json {"name":"Shan"}');

        return reply(JSON.stringify(JSON.parse(text), null, 2));
      }

      if (cmd === "calc") {
        if (!input) return reply("Usage: .calc (25 + 5) * 2");

        return reply(`RESULT: ${calculate(input)}`);
      }

      if (cmd === "password") {
        const length = input ? Number(input) : 16;

        if (!Number.isInteger(length) || length < 8 || length > 64) {
          return reply("Password length must be between 8 and 64.");
        }

        return reply(
          `RANDOM PASSWORD\n\n${generatePassword(length)}\n\nKeep your password private.`
        );
      }

      if (cmd === "bmi") {
        const [weightText, heightText] = input.split(/\s+/);
        const weight = Number(weightText);
        const height = Number(heightText);

        if (
          !Number.isFinite(weight) ||
          !Number.isFinite(height) ||
          weight <= 0 ||
          height <= 0 ||
          height > 300 ||
          weight > 500
        ) {
          return reply("Usage: .bmi <weight_kg> <height_cm>");
        }

        const bmi = weight / ((height / 100) ** 2);

        return reply(
          `BMI RESULT\n\nBMI: ${bmi.toFixed(1)}\n\nBMI alone does not determine health. For teenagers, age and growth patterns are important too.`
        );
      }

      if (cmd === "age") {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) {
          return reply("Usage: .age YYYY-MM-DD");
        }

        const [year, month, day] = input.split("-").map(Number);
        const birth = new Date(Date.UTC(year, month - 1, day));
        const now = new Date();

        if (
          birth.getUTCFullYear() !== year ||
          birth.getUTCMonth() !== month - 1 ||
          birth.getUTCDate() !== day ||
          birth > now
        ) {
          return reply("Please provide a valid birth date.");
        }

        let age = now.getUTCFullYear() - year;

        if (
          now.getUTCMonth() < month - 1 ||
          (now.getUTCMonth() === month - 1 && now.getUTCDate() < day)
        ) {
          age--;
        }

        return reply(`AGE: ${age} years`);
      }

      if (cmd === "unix") {
        const timestamp = Number(input);

        if (!Number.isFinite(timestamp)) {
          return reply("Usage: .unix <timestamp>");
        }

        const date = new Date(
          Math.abs(timestamp) < 1e12 ? timestamp * 1000 : timestamp
        );

        if (Number.isNaN(date.getTime())) {
          return reply("Invalid timestamp.");
        }

        return reply(`UTC DATE: ${date.toISOString()}`);
      }

      return reply("Unknown command. Use .devmenu");
    } catch (error) {
      return reply(`ERROR: ${error.message || "Something went wrong."}`);
    }
  }
};