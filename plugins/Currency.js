import axios from "axios";

export default {
  command: "currency",
  category: "utility",
  description: "Convert currencies using current exchange rates",

  async execute(sock, msg, args) {
    const jid = msg.key.remoteJid;

    try {
      if (args.length < 3) {
        return sock.sendMessage(jid, {
          text: "💱 *CURRENCY CONVERTER*\n\nUsage: .currency <amount> <from> <to>\n\nExample: .currency 100 USD LKR"
        }, { quoted: msg });
      }

      const amount = Number(args[0]);
      const from = args[1].toUpperCase();
      const to = args[2].toUpperCase();

      if (
        !Number.isFinite(amount) ||
        amount <= 0 ||
        !/^[A-Z]{3}$/.test(from) ||
        !/^[A-Z]{3}$/.test(to)
      ) {
        return sock.sendMessage(jid, {
          text: "❌ Invalid amount or currency code."
        }, { quoted: msg });
      }

      const response = await axios.get(
        `https://open.er-api.com/v6/latest/${from}`,
        { timeout: 15000 }
      );

      const data = response.data;

      if (data.result !== "success" || !data.rates?.[to]) {
        throw new Error("Currency not supported.");
      }

      const rate = data.rates[to];
      const result = amount * rate;

      await sock.sendMessage(jid, {
        text:
          "💱 *CURRENCY CONVERTER*\n\n" +
          `💵 Amount: ${amount} ${from}\n` +
          `💰 Converted: ${result.toLocaleString("en-US", {
            maximumFractionDigits: 4
          })} ${to}\n` +
          `📊 Exchange Rate: 1 ${from} = ${rate} ${to}\n\n` +
          `🕒 Rate Date: ${data.time_last_update_utc}`
      }, { quoted: msg });

    } catch (error) {
      console.error("[currency]", error.message);

      await sock.sendMessage(jid, {
        text: "❌ Failed to retrieve exchange rates. Please try again later."
      }, { quoted: msg });
    }
  }
};