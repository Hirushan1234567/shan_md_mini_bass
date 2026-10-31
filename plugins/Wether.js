export default {
name: "weather",
commands: ["weather", "w", "vassa"],
description: "Check current weather",
category: "tools",

async execute(sock, msg, args) {
const chat = msg.key.remoteJid;

try {
  const city = args.join(" ").trim() || "Colombo";

  await sock.sendMessage(
    chat,
    { text: "🌦️ Checking weather..." },
    { quoted: msg }
  );

  const geoRes = await fetch(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`
  );

  if (!geoRes.ok) throw new Error("Weather location service unavailable.");

  const geoData = await geoRes.json();
  const place = geoData.results?.[0];

  if (!place) {
    return sock.sendMessage(
      chat,
      { text: `❌ Location not found: ${city}\nExample: .weather Kandy` },
      { quoted: msg }
    );
  }

  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}` +
    `&longitude=${place.longitude}` +
    `&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m` +
    `&timezone=auto`;

  const response = await fetch(url);

  if (!response.ok) throw new Error("Weather service unavailable.");

  const data = await response.json();
  const current = data.current;

  if (!current) throw new Error("Current weather data is unavailable.");

  const code = current.weather_code;
  let condition = "Clear";

  if (code === 0) condition = "Clear sky ☀️";
  else if ([1, 2, 3].includes(code)) condition = "Cloudy ☁️";
  else if ([45, 48].includes(code)) condition = "Foggy 🌫️";
  else if ([51, 53, 55, 56, 57].includes(code)) condition = "Drizzle 🌦️";
  else if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) condition = "Rain 🌧️";
  else if ([71, 73, 75, 77, 85, 86].includes(code)) condition = "Snow ❄️";
  else if ([95, 96, 99].includes(code)) condition = "Thunderstorm ⛈️";

  const text =
    `╭━━〔 🌦️ WEATHER REPORT 〕━━╮\n\n` +
    `📍 Location: ${place.name}, ${place.country || ""}\n` +
    `🌤️ Condition: ${condition}\n` +
    `🌡️ Temperature: ${current.temperature_2m}°C\n` +
    `💧 Humidity: ${current.relative_humidity_2m}%\n` +
    `💨 Wind: ${current.wind_speed_10m} km/h\n` +
    `🕒 Local time: ${current.time}\n\n` +
    `╰━━━━━━━━━━━━━━━━━━━━╯\n` +
    `⚡ SHAN MINI BOT`;

  await sock.sendMessage(chat, { text }, { quoted: msg });
} catch (error) {
  console.error("[weather]", error);

  await sock.sendMessage(
    chat,
    { text: `❌ Weather error: ${error.message}` },
    { quoted: msg }
  );
}

}
};