import axios from "axios";

export default {
  command: "countryinfo",
  category: "utility",
  description: "Get country information",

  async execute(sock, msg, args) {
    const jid = msg.key.remoteJid;

    try {
      const country = args.join(" ").trim();

      if (!country) {
        return sock.sendMessage(jid, {
          text: "Usage: .countryinfo <country>\nExample: .countryinfo Sri Lanka"
        }, { quoted: msg });
      }

      const response = await axios.get(
        `https://restcountries.com/v3.1/name/${encodeURIComponent(country)}`,
        {
          params: {
            fields: "name,capital,region,subregion,population,currencies,languages,flags,cca2"
          },
          timeout: 15000
        }
      );

      const data = response.data[0];

      const currencies = Object.values(data.currencies || {})
        .map(currency => `${currency.name} (${currency.symbol || "N/A"})`)
        .join(", ");

      const languages = Object.values(data.languages || {}).join(", ");

      await sock.sendMessage(jid, {
        text:
          `🌍 *COUNTRY INFORMATION*\n\n` +
          `🏳️ Country: ${data.name.common}\n` +
          `🏛️ Capital: ${data.capital?.join(", ") || "N/A"}\n` +
          `🌐 Region: ${data.region}\n` +
          `📍 Subregion: ${data.subregion || "N/A"}\n` +
          `👥 Population: ${data.population.toLocaleString()}\n` +
          `💰 Currency: ${currencies || "N/A"}\n` +
          `🗣️ Languages: ${languages || "N/A"}\n` +
          `🆔 Country Code: ${data.cca2}\n` +
          `🏴 Flag: ${data.flags?.emoji || data.flags?.png || "N/A"}`
      }, { quoted: msg });

    } catch (error) {
      console.error("[countryinfo]", error.message);

      await sock.sendMessage(jid, {
        text: "❌ Country not found or the information service is unavailable."
      }, { quoted: msg });
    }
  }
};