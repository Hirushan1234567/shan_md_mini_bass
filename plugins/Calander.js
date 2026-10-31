export default {
  command: "calendar",
  category: "utility",
  description: "Display a monthly calendar",

  async execute(sock, msg, args) {
    const jid = msg.key.remoteJid;

    const now = new Date();

    const year = args[0] ? Number(args[0]) : now.getFullYear();
    const month = args[1] ? Number(args[1]) : now.getMonth() + 1;

    if (
      !Number.isInteger(year) ||
      !Number.isInteger(month) ||
      year < 1900 ||
      year > 2100 ||
      month < 1 ||
      month > 12
    ) {
      return sock.sendMessage(jid, {
        text: "Usage: .calendar [year] [month]\nExample: .calendar 2027 1"
      }, { quoted: msg });
    }

    const date = new Date(year, month - 1, 1);
    const monthName = date.toLocaleString("en-US", {
      month: "long"
    });

    let output = `📅 *${monthName} ${year}*\n\n`;
    output += "Su Mo Tu We Th Fr Sa\n";

    const firstDay = date.getDay();
    const days = new Date(year, month, 0).getDate();

    output += "   ".repeat(firstDay);

    for (let day = 1; day <= days; day++) {
      output += String(day).padStart(2, " ") + " ";

      if (new Date(year, month - 1, day).getDay() === 6) {
        output += "\n";
      }
    }

    await sock.sendMessage(jid, {
      text: output.trim()
    }, { quoted: msg });
  }
};