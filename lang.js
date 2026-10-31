// lang.js  (index.js එක ළඟ — root folder එකේ)
// SHAN MINI BOT V1 — shared translations (English / සිංහල)
//
// Plugins වල:   import { t, ta, desc, langOf } from "../lang.js";
//               const lang = await langOf(msg);
//               await say(t("common.group_only", lang));
//
// භාෂාව තෝරන්නේ settings plugin එකෙන් (.settings → 1.7, group එකකට .gset lang si).
// අලුත් භාෂාවක් එකතු කරන්න: DICT.<code> එකක් හදලා, නැති keys English වලින් auto fallback වෙනවා.

export const LANGS = ["en", "si"];

/* =====================================================
   HELPERS
===================================================== */

export function t(key, lang = "en", vars = {}) {
  const value = DICT[lang]?.[key] ?? DICT.en[key];

  if (value === undefined) return key;
  if (typeof value !== "string") return value;

  return value.replace(/\{(\w+)\}/g, (_, name) =>
    name in vars ? String(vars[name]) : `{${name}}`
  );
}

// arrays (truth / dare lists)
export function ta(key, lang = "en") {
  const value = DICT[lang]?.[key] ?? DICT.en[key];
  return Array.isArray(value) ? value : [];
}

// menu command descriptions
export function desc(text, lang = "en") {
  return lang === "si" ? DESC_SI[text] || text : text;
}

// settings plugin එක globalThis.SHAN_GET_LANG define කරනවා (group override + global)
export async function langOf(msg) {
  try {
    const value = await globalThis.SHAN_GET_LANG?.(msg);
    return LANGS.includes(value) ? value : "en";
  } catch {
    return "en";
  }
}

/* =====================================================
   MENU COMMAND DESCRIPTIONS (සිංහල)
===================================================== */

const DESC_SI = {
  "Open the main menu": "ප්‍රධාන menu එක විවෘත කරන්න",
  "Show help menu": "උදව් menu එක පෙන්වන්න",
  "Show all commands": "සියලුම commands පෙන්වන්න",
  "Show command list": "command ලැයිස්තුව පෙන්වන්න",
  "Check bot status": "Bot ගේ තත්වය පරීක්ෂා කරන්න",
  "Bot information": "Bot ගැන තොරතුරු",
  "Show uptime": "ක්‍රියාත්මක වූ කාලය පෙන්වන්න",
  "Owner contact": "Owner ගේ සම්බන්ධතාව",
  "Search and download music": "සංගීතය සොයා බාගත කරන්න",
  "Alternative music downloader": "විකල්ප සංගීත බාගත කරන්නා",
  "Search and download songs": "ගීත සොයා බාගත කරන්න",
  "YouTube song downloader": "YouTube ගීත බාගත කරන්නා",
  "Search YouTube, reply with a number to download": "YouTube සොයන්න, බාගත කිරීමට ඉලක්කමක් reply කරන්න",
  "Download Facebook media": "Facebook මාධ්‍ය බාගත කරන්න",
  "Search for an APK": "APK එකක් සොයන්න",
  "Search applications": "Applications සොයන්න",
  "Forward a replied message/file": "Reply කළ පණිවිඩය/ගොනුව forward කරන්න",
  "Send a replied message/file": "Reply කළ පණිවිඩය/ගොනුව යවන්න",
  "Get chat or message JID": "Chat හෝ පණිවිඩයේ JID ලබාගන්න",
  "Get chat ID": "Chat ID ලබාගන්න",
  "Get JID": "JID ලබාගන්න",
  "Search movies": "චිත්‍රපට සොයන්න",
  "Get movie information": "චිත්‍රපට තොරතුරු ලබාගන්න",
  "Download supported content": "සහාය දක්වන අන්තර්ගතය බාගත කරන්න",
  "Test Cinesubz API": "Cinesubz API පරීක්ෂා කරන්න",
  "Search cartoons": "කාටූන් සොයන්න",
  "Browse cartoons": "කාටූන් බලන්න",
  "Browse cartoons by letter": "අකුරෙන් කාටූන් බලන්න",
  "Search Cartoons.lk": "Cartoons.lk සොයන්න",
  "Debug a supported cartoon page": "සහාය දක්වන කාටූන් පිටුවක් debug කරන්න",
  "Group information": "Group තොරතුරු",
  "Show group details": "Group විස්තර පෙන්වන්න",
  "List group admins": "Group admins ලැයිස්තුව",
  "Tag group admins": "Group admins tag කරන්න",
  "Tag group members": "Group සාමාජිකයින් tag කරන්න",
  "Send a hidden-tag message": "Hidden-tag පණිවිඩයක් යවන්න",
  "Promote a member": "සාමාජිකයෙකු admin කරන්න",
  "Demote an admin": "Admin කෙනෙකුගේ තනතුර අඩු කරන්න",
  "Remove a member": "සාමාජිකයෙකු ඉවත් කරන්න",
  "Add a member": "සාමාජිකයෙකු එකතු කරන්න",
  "Open group chat": "Group chat එක විවෘත කරන්න",
  "Close group chat": "Group chat එක වසන්න",
  "Change group subject": "Group නම වෙනස් කරන්න",
  "Change group description": "Group විස්තරය වෙනස් කරන්න",
  "Get group invite link": "Group invite link එක ලබාගන්න",
  "Reset group invite link": "Group invite link එක යළි පිහිටුවන්න",
  "Leave the group": "Group එකෙන් ඉවත් වන්න",
  "Per-group protection settings (group admins)": "Group එකකට වෙනම ආරක්ෂණ සැකසුම් (group admins)",
  "Anti Link for this group only": "මේ group එකට පමණක් Anti Link",
  "Punishment for this group only": "මේ group එකට පමණක් දඬුවම",
  "Reset this group to bot-wide defaults": "මේ group එක bot-wide default වලට යළි පිහිටුවන්න",
  "Add a bot admin (owner only)": "Bot admin කෙනෙකු එකතු කරන්න (owner ට පමණි)",
  "Remove a bot admin (owner only)": "Bot admin කෙනෙකු ඉවත් කරන්න (owner ට පමණි)",
  "List bot admins (owner only)": "Bot admins ලැයිස්තුව (owner ට පමණි)",
  "Admin information (owner only)": "Admin තොරතුරු (owner ට පමණි)",
  "View admin logs (owner only)": "Admin logs බලන්න (owner ට පමණි)",
  "Block bot access": "Bot භාවිතය අවහිර කරන්න",
  "Unblock bot access": "Bot භාවිතය නැවත ලබාදෙන්න",
  "Block a user": "පරිශීලකයෙකු Block කරන්න",
  "Grant Premium access": "Premium ප්‍රවේශය ලබාදෙන්න",
  "Extend Premium access": "Premium ප්‍රවේශය දීර්ඝ කරන්න",
  "Remove Premium access": "Premium ප්‍රවේශය ඉවත් කරන්න",
  "View Premium user details": "Premium පරිශීලක විස්තර බලන්න",
  "List Premium users on this bot": "මේ bot හි Premium පරිශීලකයින්",
  "List Premium users across bots (owner only)": "සියලු bots වල Premium පරිශීලකයින් (owner ට පමණි)",
  "Premium user list alias": "Premium ලැයිස්තු කෙටිමඟ",
  "Check your Premium status": "ඔබේ Premium තත්වය බලන්න",
  "Enable Premium-only access (owner only)": "Premium-only ප්‍රවේශය සක්‍රීය කරන්න (owner ට පමණි)",
  "Remove Premium-only restriction (owner only)": "Premium-only සීමාව ඉවත් කරන්න (owner ට පමණි)",
  "List Premium-only commands": "Premium-only commands ලැයිස්තුව",
  "Check the weather": "කාලගුණය බලන්න",
  "Weather shortcut": "කාලගුණ කෙටිමඟ",
  "Get the latest news": "නවතම පුවත් ලබාගන්න",
  "Sri Lankan news": "ශ්‍රී ලාංකික පුවත්",
  "Get profile picture": "Profile පින්තූරය ලබාගන්න",
  "Profile picture shortcut": "Profile පින්තූර කෙටිමඟ",
  "Translate text": "පෙළ පරිවර්තනය කරන්න",
  "Translation shortcut": "පරිවර්තන කෙටිමඟ",
  "Generate a QR code": "QR code එකක් සාදන්න",
  "Show all toolkit commands": "සියලුම toolkit commands පෙන්වන්න",
  "Auto-delete links + warn (group admins)": "Links ස්වයංව මකා අනතුරු ඇඟවීම (group admins)",
  "Warn a member (group admins)": "සාමාජිකයෙකුට අනතුරු අඟවන්න (group admins)",
  "Check warnings": "අනතුරු ඇඟවීම් බලන්න",
  "Reset warnings (group admins)": "අනතුරු ඇඟවීම් යළි පිහිටුවන්න (group admins)",
  "Send to all groups (owner only)": "සියලුම groups වලට යවන්න (owner ට පමණි)",
  "Stop a running broadcast (owner only)": "ක්‍රියාත්මක broadcast නතර කරන්න (owner ට පමණි)",
  "Calculator": "ගණකය",
  "Check bot speed": "Bot ගේ වේගය බලන්න",
  "Bot statistics": "Bot සංඛ්‍යාලේඛන",
  "Sri Lanka date & time": "ශ්‍රී ලංකා දිනය සහ වේලාව",
  "Shorten a link": "Link එකක් කෙටි කරන්න",
  "Flip a coin": "කාසියක් උඩ දමන්න",
  "Roll a dice": "දාදු කැටයක් දමන්න",
  "Pick a random option": "අහඹු විකල්පයක් තෝරන්න",
  "Magic 8-ball": "මායා 8-ball",
  "Random truth question": "අහඹු Truth ප්‍රශ්නයක්",
  "Random dare": "අහඹු Dare එකක්",
  "Search song lyrics": "ගීත පද සොයන්න",
  "Lyrics alias": "ගීත පද කෙටිමඟ",
  "Lyrics shortcut": "ගීත පද කෙටිමඟ",
  "Publish a song to a WhatsApp channel": "ගීතයක් WhatsApp channel එකකට පළ කරන්න",
  "Channel song alias": "Channel ගීත කෙටිමඟ",
  "Get a random fact": "අහඹු කරුණක් ලබාගන්න",
  "Get random facts": "අහඹු කරුණු ලබාගන්න",
  "Convert replied media to a sticker": "Reply කළ මාධ්‍යය sticker එකක් කරන්න",
  "Sticker shortcut": "Sticker කෙටිමඟ",
  "Sticker alias": "Sticker කෙටිමඟ",
  "Ask AI a question": "AI ගෙන් ප්‍රශ්නයක් අහන්න",
  "Bot settings": "Bot සැකසුම්",
  "Pair a WhatsApp number": "WhatsApp අංකයක් pair කරන්න",
  "Unpair a session": "Session එකක් unpair කරන්න",
  "List paired sessions": "Pair කළ sessions ලැයිස්තුව"
};

/* =====================================================
   DICTIONARY
===================================================== */

const DICT = {
  /* ---------------------------------------------------
     ENGLISH
  --------------------------------------------------- */
  en: {
    /* common */
    "common.group_only": "👥 This command works in groups only.",
    "common.admins_only": "🛡️ Group admins only.",
    "common.owner_only": "👑 Owner only.",
    "common.error": "❌ Error: {msg}",
    "common.expired": "⌛ This list has expired. Please search again.",

    /* index.js */
    "idx.blocked": "🚫 You are blocked from using this bot.",
    "idx.owner_only": "👑 This bot is currently owner-only.",
    "idx.private": "🔒 Bot is currently in private mode.",
    "idx.cooldown": "⏳ Slow down! Please wait {s}s before using another command.",
    "idx.cmd_error": "❌ Command Error\n\n{msg}",
    "idx.premium_other":
      "💎 PREMIUM COMMAND\n\nYour Premium doesn't work on this bot.\n\n✅ Your Premium is active only on:\n{bots}\n\nPlease use that bot to use your Premium.",
    "idx.premium_none":
      "💎 PREMIUM COMMAND\n\nThis command is for Premium users only.\n\nYou don't have Premium yet. Contact the owner or a bot admin to get it.\n📞 {p}owner",

    /* menu */
    "menu.hello": "Hello, *{name}*",
    "menu.prefix": "Prefix",
    "menu.uptime": "Uptime",
    "menu.select": "SELECT A CATEGORY",
    "menu.all": "ALL COMMANDS",
    "menu.reply_hint": "Reply to this message with a number.",
    "menu.valid": "Valid for 5 minutes — you can reuse it.",
    "menu.back_hint": "Reply with another number, or *menu* to go back.",
    "menu.no_cmds": "No commands here yet.",
    "menu.no_premium": "No Premium-only commands right now.",
    "menu.bad_number": "❌ Choose a number from 0 to {max}.",
    "menu.error": "❌ Menu error. Try again.",
    "menu.premium_only": "🔒 Premium only",
    "menu.cat.main": "MAIN",
    "menu.cat.downloader": "DOWNLOADER",
    "menu.cat.movies": "MOVIES & CARTOONS",
    "menu.cat.group": "GROUP",
    "menu.cat.premium": "PREMIUM COMMANDS",
    "menu.cat.admin": "ADMIN TOOLS",
    "menu.cat.toolkit": "TOOLKIT",
    "menu.cat.tools": "TOOLS",
    "menu.cat.music": "MUSIC",
    "menu.cat.fun": "FUN",
    "menu.cat.ai": "AI",
    "menu.cat.owner": "OWNER & SYSTEM",

    /* settings */
    "set.title": "BOT SETTINGS PANEL",
    "set.user": "User",
    "set.bot": "Bot",
    "set.date": "Date",
    "set.active": "Active Features",
    "set.worktype": "Work Type",
    "set.public": "Public",
    "set.private": "Private",
    "set.owneronly": "Owner Only",
    "set.items": "{n} items",
    "set.howto": "HOW TO USE",
    "set.how1": "Reply to this message with a code",
    "set.how2": "• ON/OFF → *3.3*  or  *3.3 off*",
    "set.how3": "• Options → *3.6* (switches to next)",
    "set.how4": "• Numbers / texts → *2.6 30*  |  *4.4 My Pack*",
    "set.how5": "• Lists → *3.13 +word*  |  *3.13 -word*  |  *3.13 clear*",
    "set.how6": "• Reset all → *RESET*",
    "set.use_onoff": "❌ Use *on* or *off*.",
    "set.choose": "❌ Choose one of: {opts}",
    "set.num_now": "🔢 *{label}* is now *{value}*\n\nSend a new value:\n{id} <{min}-{max}>{note}",
    "set.num_range": "❌ Enter a number between {min} and {max}.",
    "set.text_view": "✏️ *{label}*\n\nCurrent:\n{value}\n\nSend a new value:\n{id} <text>{note}\nReset: {id} default",
    "set.too_long": "❌ Too long. Maximum {max} characters.",
    "set.invalid": "❌ Invalid value. {detail}",
    "set.list_view": "📋 *{label}* ({n})\n\n{list}\n\nAdd: {id} +{hint}\nRemove: {id} -{hint}\nClear: {id} clear",
    "set.empty": "— empty —",
    "set.nothing": "❌ Nothing to add or remove.",
    "set.done": "✅ {label} → *{value}*",
    "set.reset_ask": "⚠️ This will reset *all* settings to default.\nSend *RESET CONFIRM* to continue.",
    "set.reset_done": "✅ All settings were reset to default.",
    "set.val_missing": "❌ Value missing.",
    "set.update_fail": "❌ Settings update failed. Please try again.",
    "set.owner_only": "👑 Only the owner can change settings.",
    "set.load_fail": "❌ Unable to load settings.",
    "inv.prefix": "Maximum 3 characters; spaces are not allowed.",
    "note.minutes between auto replies per person": "minutes between auto replies per person",
    "note.use {user} {group} {count}": "use {user} {group} {count}",
    "note.messages within 8 seconds": "messages within 8 seconds",
    "note.warnings before kick": "warnings before kick",
    "note.seconds between commands per user (0 = off)": "seconds between commands per user (0 = off)",

    /* group settings (.gset) */
    "gs.title": "GROUP SETTINGS",
    "gs.this": "(this group)",
    "gs.default": "(default)",
    "gs.howto_reset": "everything back to default",
    "gs.note": "ℹ️ \"default\" = the bot-wide value from {p}settings.",
    "gs.db": "❌ Database is not connected.",
    "gs.unknown": "❌ Unknown option *{sub}*.\nSend *{p}gset* to see the list.",
    "gs.use_onoff": "❌ Use *on*, *off* or *default*.",
    "gs.usage": "{emoji} *{label}*\nUsage: {p}gset {sub} {hint}",
    "gs.reset_ok": "✅ This group's settings were reset to default.",
    "gs.default_shown": "default ({value})",
    "gs.botadmin": "⚠️ Make the bot a group admin, otherwise it can't delete messages or remove members.",
    "gs.fail": "❌ Could not update group settings.",
    "gs.l.antilink": "Anti Link",
    "gs.l.badword": "Anti Badword",
    "gs.l.spam": "Anti Spam",
    "gs.l.fake": "Anti Fake",
    "gs.l.welcome": "Welcome",
    "gs.l.goodbye": "Goodbye",
    "gs.l.punish": "Punishment",
    "gs.l.warnlimit": "Warn Limit",
    "gs.l.lang": "Language",
    "fake.removed": "🚫 @{num} was removed — only +{codes} numbers are allowed in this group.",

    /* settings item labels */
    "lang.en": "English",
    "lang.si": "සිංහල",

    /* ytsearch */
    "yt.usage": "🔎 *YOUTUBE SEARCH*\n\nUsage:\n{p}ytsearch <words>\n\nExample:\n{p}ytsearch Nadeemal Perera",
    "yt.title": "YOUTUBE SEARCH",
    "yt.none": "❌ No results found.",
    "yt.reply": "↪ Reply with 1-{n} to download",
    "yt.bad": "❌ Choose a number from 1 to {n}.",
    "yt.failed": "Search failed",

    /* song */
    "sg.usage": "🎵 *SONG DOWNLOADER*\n\nUsage:\n{p}song <song name>\n{p}song <YouTube link>\n\nExample:\n{p}song Nasuna",
    "sg.too_long": "⚠️ This video is too long ({dur}).\nMaximum: {max} minutes.",
    "sg.info": "SONG INFORMATION",
    "sg.f_title": "Title    ",
    "sg.f_artist": "Artist   ",
    "sg.f_views": "Views    ",
    "sg.f_released": "Released ",
    "sg.f_duration": "Duration ",
    "sg.select": "SELECT DOWNLOAD TYPE",
    "sg.opt1": "Audio File",
    "sg.opt2": "Audio Document",
    "sg.opt3": "Voice Message",
    "sg.reply123": "↪ Reply with 1, 2, or 3",
    "sg.premium": "💎 This is a Premium feature.\n\nContact the owner or a bot admin to get Premium.",
    "sg.busy": "⏳ A song is already being prepared in this chat. Please wait.",
    "sg.send_err": "❌ Could not send the song.\n\n{msg}",
    "sg.search_failed": "Search failed",

    /* toolkit */
    "tk.title": "🧰 *TOOLKIT*",
    "tk.h_mod": "🛡️ *Moderation*",
    "tk.h_owner": "📢 *Owner*",
    "tk.h_tools": "🛠️ *Tools*",
    "tk.h_fun": "🎮 *Fun*",
    "tk.al_title": "🔗 *ANTILINK*  (now: *{cur}*)",
    "tk.al_on": "all links",
    "tk.al_wa": "WhatsApp group links only",
    "tk.al_set": "🔗 Antilink: *{mode}*",
    "tk.al_noadmin": "⚠️ Make the bot a group admin, otherwise it can't delete links.",
    "tk.warn_usage": "Usage: {p}warn @user [reason]\n(or reply to their message)",
    "tk.warn_admin": "🛡️ You can't warn a group admin.",
    "tk.no_reason": "No reason given",
    "tk.reason_links": "Sending links",
    "tk.warn_msg": "⚠️ *WARNING {n}/{max}*\n\n👤 @{num}\n📌 Reason: {reason}\n\n{tail}",
    "tk.warn_left": "_{left} more warning(s) and you will be removed._",
    "tk.warn_limit": "🚫 _Limit reached — removing from the group._",
    "tk.warn_kick_fail": "❌ Could not remove the user (is the bot an admin?).",
    "tk.warns_of": "⚠️ @{num} has *{c}/{max}* warnings.",
    "tk.resetwarn_usage": "Usage: {p}resetwarn @user",
    "tk.resetwarn_ok": "✅ Warnings reset for @{num}.",
    "tk.bc_usage": "Usage: {p}broadcast <message>\n\nSends to all groups (3–6s gap, max {max}).",
    "tk.bc_running": "⏳ A broadcast is already running. Use stop to cancel.",
    "tk.bc_started": "📢 Broadcast started. You'll get a report when it's done.",
    "tk.bc_stopping": "🛑 Stopping broadcast...",
    "tk.bc_done": "📢 *BROADCAST DONE*\n\n✅ Sent: {ok}\n❌ Failed: {fail}\n📊 Total groups: {total}",
    "tk.bc_stopped": "📢 *BROADCAST STOPPED*\n\n✅ Sent: {ok}\n❌ Failed: {fail}\n📊 Total groups: {total}",
    "tk.calc_usage": "Usage: {p}calc 12*(3+4)",
    "calc.invalid": "Invalid expression.",
    "calc.chars": "Only numbers and + - * / % ^ ( ) are allowed.",
    "calc.result": "Result is not a valid number.",
    "tk.pinging": "🏓 Pinging...",
    "tk.pong": "🏓 *Pong!* {ms} ms",
    "tk.stats": "📊 *{bot}*\n\n⏱️ Uptime : {up}\n💾 Memory : {mem} MB\n👥 Groups : {groups}\n🟢 Node : {node}",
    "tk.sltime": "🇱🇰 *Sri Lanka Time*\n\n🕒 {d}",
    "tk.short_usage": "Usage: {p}shorturl https://example.com/long/link",
    "tk.short_fail": "❌ Could not shorten the link.\n{msg}",
    "tk.heads": "HEADS",
    "tk.tails": "TAILS",
    "tk.choose_usage": "Usage: {p}choose pizza | burger | rice",
    "tk.choose_res": "🎯 I choose: *{x}*",
    "tk.ball_usage": "Usage: {p}8ball will I pass?",
    "tk.truth_h": "🫢 *TRUTH*",
    "tk.dare_h": "😈 *DARE*",
    "tk.truths": [
      "What's the most embarrassing thing you've done in public?",
      "Who was your first crush?",
      "What's a secret you've never told anyone in this group?",
      "What's the last lie you told?",
      "Which person in this group would you trade lives with?",
      "What's your biggest fear?"
    ],
    "tk.dares": [
      "Send a voice note singing your favourite song.",
      "Change your WhatsApp status to 'I love this bot' for 1 hour.",
      "Text your best friend 'I miss you' right now.",
      "Send your most recent photo from the gallery.",
      "Talk only in emojis for the next 10 minutes.",
      "Say the alphabet backwards in a voice note."
    ],
    "tk.ball": [
      "Yes ✅", "No ❌", "Maybe 🤔", "Definitely 💯",
      "Ask again later ⏳", "I don't think so 🙅", "Absolutely 🔥", "Not a chance 🚫"
    ]
  },

  /* ---------------------------------------------------
     SINHALA
  --------------------------------------------------- */
  si: {
    /* common */
    "common.group_only": "👥 මේ command එක වැඩ කරන්නේ groups වල විතරයි.",
    "common.admins_only": "🛡️ Group admins ට පමණයි.",
    "common.owner_only": "👑 Owner ට පමණයි.",
    "common.error": "❌ දෝෂයක්: {msg}",
    "common.expired": "⌛ මේ ලැයිස්තුව කල් ඉකුත් වී ඇත. නැවත සොයන්න.",

    /* index.js */
    "idx.blocked": "🚫 ඔබට මේ bot භාවිතා කිරීම අවහිර කර ඇත.",
    "idx.owner_only": "👑 මේ bot දැනට owner ට පමණක් වැඩ කරයි.",
    "idx.private": "🔒 Bot දැනට private මාදිලියේ පවතී.",
    "idx.cooldown": "⏳ ටිකක් හෙමින්! තවත් command එකක් භාවිතා කිරීමට පෙර තත්පර {s}ක් රැඳී සිටින්න.",
    "idx.cmd_error": "❌ Command දෝෂයක්\n\n{msg}",
    "idx.premium_other":
      "💎 PREMIUM COMMAND\n\nඔබේ Premium මේ bot එකේ වැඩ නොකරයි.\n\n✅ ඔබේ Premium ක්‍රියාත්මක වන්නේ:\n{bots}\n\nඔබේ Premium භාවිතා කිරීමට ඒ bot එක භාවිතා කරන්න.",
    "idx.premium_none":
      "💎 PREMIUM COMMAND\n\nමේ command එක Premium පරිශීලකයින්ට පමණි.\n\nඔබට තවම Premium නැත. ලබාගැනීමට owner හෝ bot admin අමතන්න.\n📞 {p}owner",

    /* menu */
    "menu.hello": "ආයුබෝවන්, *{name}*",
    "menu.prefix": "Prefix",
    "menu.uptime": "ක්‍රියාත්මක කාලය",
    "menu.select": "කාණ්ඩයක් තෝරන්න",
    "menu.all": "සියලුම COMMANDS",
    "menu.reply_hint": "ඉලක්කමක් සමඟ මේ පණිවිඩයට reply කරන්න.",
    "menu.valid": "විනාඩි 5ක් වලංගුයි — නැවත නැවත භාවිතා කළ හැක.",
    "menu.back_hint": "වෙනත් ඉලක්කමක් reply කරන්න, නැතිනම් ආපසු යාමට *menu* කියන්න.",
    "menu.no_cmds": "තවම commands නැත.",
    "menu.no_premium": "දැනට Premium-only commands නැත.",
    "menu.bad_number": "❌ 0 සිට {max} දක්වා ඉලක්කමක් තෝරන්න.",
    "menu.error": "❌ Menu දෝෂයක්. නැවත උත්සාහ කරන්න.",
    "menu.premium_only": "🔒 Premium පමණි",
    "menu.cat.main": "ප්‍රධාන",
    "menu.cat.downloader": "බාගත කිරීම්",
    "menu.cat.movies": "චිත්‍රපට සහ කාටූන්",
    "menu.cat.group": "GROUP",
    "menu.cat.premium": "PREMIUM COMMANDS",
    "menu.cat.admin": "ADMIN මෙවලම්",
    "menu.cat.toolkit": "මෙවලම් කට්ටලය",
    "menu.cat.tools": "මෙවලම්",
    "menu.cat.music": "සංගීතය",
    "menu.cat.fun": "විනෝදය",
    "menu.cat.ai": "AI",
    "menu.cat.owner": "OWNER සහ පද්ධතිය",

    /* settings */
    "set.title": "BOT සැකසුම් පුවරුව",
    "set.user": "පරිශීලක",
    "set.bot": "Bot",
    "set.date": "දිනය",
    "set.active": "ක්‍රියාත්මක අංග",
    "set.worktype": "ක්‍රියාකාරී ආකාරය",
    "set.public": "පොදු (Public)",
    "set.private": "පුද්ගලික (Private)",
    "set.owneronly": "Owner ට පමණක්",
    "set.items": "{n} ක්",
    "set.howto": "භාවිතා කරන ආකාරය",
    "set.how1": "කේතයක් සමඟ මේ පණිවිඩයට reply කරන්න",
    "set.how2": "• ON/OFF → *3.3*  හෝ  *3.3 off*",
    "set.how3": "• තේරීම් → *3.6* (ඊළඟ අගයට මාරු වේ)",
    "set.how4": "• ඉලක්කම් / පෙළ → *2.6 30*  |  *4.4 My Pack*",
    "set.how5": "• ලැයිස්තු → *3.13 +වචනය*  |  *3.13 -වචනය*  |  *3.13 clear*",
    "set.how6": "• සියල්ල යළි පිහිටුවන්න → *RESET*",
    "set.use_onoff": "❌ *on* හෝ *off* භාවිතා කරන්න.",
    "set.choose": "❌ මේවායින් එකක් තෝරන්න: {opts}",
    "set.num_now": "🔢 *{label}* දැන් *{value}*\n\nනව අගයක් යවන්න:\n{id} <{min}-{max}>{note}",
    "set.num_range": "❌ {min} සිට {max} දක්වා ඉලක්කමක් ඇතුළත් කරන්න.",
    "set.text_view": "✏️ *{label}*\n\nවර්තමාන අගය:\n{value}\n\nනව අගයක් යවන්න:\n{id} <පෙළ>{note}\nයළි පිහිටුවීම: {id} default",
    "set.too_long": "❌ දිග වැඩියි. උපරිම අකුරු {max} යි.",
    "set.invalid": "❌ වලංගු නොවන අගයක්. {detail}",
    "set.list_view": "📋 *{label}* ({n})\n\n{list}\n\nඑක් කරන්න: {id} +{hint}\nඅයින් කරන්න: {id} -{hint}\nසියල්ල මකන්න: {id} clear",
    "set.empty": "— හිස් —",
    "set.nothing": "❌ එක් කිරීමට හෝ අයින් කිරීමට කිසිවක් නැත.",
    "set.done": "✅ {label} → *{value}*",
    "set.reset_ask": "⚠️ මෙය *සියලුම* සැකසුම් default වලට යළි පිහිටුවයි.\nඉදිරියට යාමට *RESET CONFIRM* යවන්න.",
    "set.reset_done": "✅ සියලුම සැකසුම් default වලට යළි පිහිටුවා ඇත.",
    "set.val_missing": "❌ අගය නොමැත.",
    "set.update_fail": "❌ සැකසුම් යාවත්කාලීන කිරීම අසාර්ථකයි. නැවත උත්සාහ කරන්න.",
    "set.owner_only": "👑 සැකසුම් වෙනස් කළ හැක්කේ owner ට පමණි.",
    "set.load_fail": "❌ සැකසුම් පූරණය කළ නොහැක.",
    "inv.prefix": "උපරිම අකුරු 3ක්; හිස්තැන් භාවිතා කළ නොහැක.",
    "note.minutes between auto replies per person": "එක පුද්ගලයෙකුට ස්වයං පිළිතුරු අතර මිනිත්තු ගණන",
    "note.use {user} {group} {count}": "{user} {group} {count} භාවිතා කරන්න",
    "note.messages within 8 seconds": "තත්පර 8ක් ඇතුළත පණිවිඩ ගණන",
    "note.warnings before kick": "Kick කිරීමට පෙර අනතුරු ඇඟවීම් ගණන",
    "note.seconds between commands per user (0 = off)": "එක user කෙනෙකුට commands අතර තත්පර ගණන (0 = off)",

    /* group settings (.gset) */
    "gs.title": "GROUP සැකසුම්",
    "gs.this": "(මේ group එක)",
    "gs.default": "(default)",
    "gs.howto_reset": "සියල්ල default වලට",
    "gs.note": "ℹ️ \"default\" = {p}settings හි bot-wide අගය.",
    "gs.db": "❌ Database සම්බන්ධ වී නැත.",
    "gs.unknown": "❌ *{sub}* නොදන්නා විකල්පයකි.\nලැයිස්තුව බැලීමට *{p}gset* යවන්න.",
    "gs.use_onoff": "❌ *on*, *off* හෝ *default* භාවිතා කරන්න.",
    "gs.usage": "{emoji} *{label}*\nභාවිතය: {p}gset {sub} {hint}",
    "gs.reset_ok": "✅ මේ group එකේ සැකසුම් default වලට යළි පිහිටුවා ඇත.",
    "gs.default_shown": "default ({value})",
    "gs.botadmin": "⚠️ Bot ව group admin කරන්න, නැතිනම් පණිවිඩ මැකීමට හෝ සාමාජිකයින් ඉවත් කිරීමට නොහැක.",
    "gs.fail": "❌ Group සැකසුම් යාවත්කාලීන කළ නොහැකි විය.",
    "gs.l.antilink": "Anti Link",
    "gs.l.badword": "Anti Badword",
    "gs.l.spam": "Anti Spam",
    "gs.l.fake": "Anti Fake",
    "gs.l.welcome": "ආයුබෝවන් පණිවිඩය",
    "gs.l.goodbye": "සමුගැනීමේ පණිවිඩය",
    "gs.l.punish": "දඬුවම",
    "gs.l.warnlimit": "අනතුරු ඇඟවීම් සීමාව",
    "gs.l.lang": "භාෂාව",
    "fake.removed": "🚫 @{num} ඉවත් කරන ලදී — මේ group එකට අවසර ඇත්තේ +{codes} අංක වලට පමණි.",

    "lang.en": "English",
    "lang.si": "සිංහල",

    /* ytsearch */
    "yt.usage": "🔎 *YOUTUBE සෙවුම*\n\nභාවිතය:\n{p}ytsearch <වචන>\n\nඋදාහරණය:\n{p}ytsearch Nadeemal Perera",
    "yt.title": "YOUTUBE සෙවුම",
    "yt.none": "❌ ප්‍රතිඵල හමු නොවීය.",
    "yt.reply": "↪ බාගත කිරීමට 1-{n} reply කරන්න",
    "yt.bad": "❌ 1 සිට {n} දක්වා ඉලක්කමක් තෝරන්න.",
    "yt.failed": "සෙවීම අසාර්ථකයි",

    /* song */
    "sg.usage": "🎵 *SONG DOWNLOADER*\n\nභාවිතය:\n{p}song <ගීතයේ නම>\n{p}song <YouTube link>\n\nඋදාහරණය:\n{p}song Nasuna",
    "sg.too_long": "⚠️ මේ වීඩියෝව දිග වැඩියි ({dur}).\nඋපරිමය: විනාඩි {max}.",
    "sg.info": "ගීත තොරතුරු",
    "sg.f_title": "ගීතය",
    "sg.f_artist": "ගායකයා",
    "sg.f_views": "නැරඹුම්",
    "sg.f_released": "නිකුත් වූයේ",
    "sg.f_duration": "කාලය",
    "sg.select": "බාගත කිරීමේ වර්ගය තෝරන්න",
    "sg.opt1": "Audio ගොනුව",
    "sg.opt2": "Audio Document",
    "sg.opt3": "Voice පණිවිඩය",
    "sg.reply123": "↪ 1, 2, හෝ 3 reply කරන්න",
    "sg.premium": "💎 මෙය Premium අංගයකි.\n\nPremium ගැනීමට owner හෝ bot admin අමතන්න.",
    "sg.busy": "⏳ මේ chat එකේ ගීතයක් දැනටමත් සකස් වෙමින් පවතී. කරුණාකර රැඳී සිටින්න.",
    "sg.send_err": "❌ ගීතය යැවීමට නොහැකි විය.\n\n{msg}",
    "sg.search_failed": "සෙවීම අසාර්ථකයි",

    /* toolkit */
    "tk.title": "🧰 *මෙවලම් කට්ටලය*",
    "tk.h_mod": "🛡️ *පාලනය (Moderation)*",
    "tk.h_owner": "📢 *Owner*",
    "tk.h_tools": "🛠️ *මෙවලම්*",
    "tk.h_fun": "🎮 *විනෝදය*",
    "tk.al_title": "🔗 *ANTILINK*  (දැන්: *{cur}*)",
    "tk.al_on": "සියලුම links",
    "tk.al_wa": "WhatsApp group links පමණක්",
    "tk.al_set": "🔗 Antilink: *{mode}*",
    "tk.al_noadmin": "⚠️ Bot ව group admin කරන්න, නැතිනම් links මැකිය නොහැක.",
    "tk.warn_usage": "භාවිතය: {p}warn @user [හේතුව]\n(හෝ ඔවුන්ගේ පණිවිඩයට reply කරන්න)",
    "tk.warn_admin": "🛡️ Group admin කෙනෙකුට warn කළ නොහැක.",
    "tk.no_reason": "හේතුවක් දක්වා නැත",
    "tk.reason_links": "Links යැවීම",
    "tk.warn_msg": "⚠️ *අනතුරු ඇඟවීම {n}/{max}*\n\n👤 @{num}\n📌 හේතුව: {reason}\n\n{tail}",
    "tk.warn_left": "_තවත් අනතුරු ඇඟවීම් {left}කින් ඔබව ඉවත් කරනු ලැබේ._",
    "tk.warn_limit": "🚫 _සීමාව ඉක්මවා ඇත — group එකෙන් ඉවත් කරමින්._",
    "tk.warn_kick_fail": "❌ පරිශීලකයා ඉවත් කළ නොහැකි විය (bot admin ද?).",
    "tk.warns_of": "⚠️ @{num} සතුව අනතුරු ඇඟවීම් *{c}/{max}* ක් ඇත.",
    "tk.resetwarn_usage": "භාවිතය: {p}resetwarn @user",
    "tk.resetwarn_ok": "✅ @{num} ගේ අනතුරු ඇඟවීම් යළි පිහිටුවා ඇත.",
    "tk.bc_usage": "භාවිතය: {p}broadcast <පණිවිඩය>\n\nසියලුම groups වලට යවයි (තත්පර 3–6 පරතරයක්, උපරිම {max}).",
    "tk.bc_running": "⏳ Broadcast එකක් දැනටමත් ක්‍රියාත්මකයි. නතර කිරීමට stop භාවිතා කරන්න.",
    "tk.bc_started": "📢 Broadcast ආරම්භ විය. අවසන් වූ විට වාර්තාවක් ලැබෙනු ඇත.",
    "tk.bc_stopping": "🛑 Broadcast නතර කරමින්...",
    "tk.bc_done": "📢 *BROADCAST අවසන්*\n\n✅ යැවූ: {ok}\n❌ අසාර්ථක: {fail}\n📊 මුළු groups: {total}",
    "tk.bc_stopped": "📢 *BROADCAST නතර කරන ලදී*\n\n✅ යැවූ: {ok}\n❌ අසාර්ථක: {fail}\n📊 මුළු groups: {total}",
    "tk.calc_usage": "භාවිතය: {p}calc 12*(3+4)",
    "calc.invalid": "වලංගු නොවන ප්‍රකාශනයකි.",
    "calc.chars": "අවසර ඇත්තේ ඉලක්කම් සහ + - * / % ^ ( ) පමණි.",
    "calc.result": "ප්‍රතිඵලය වලංගු ඉලක්කමක් නොවේ.",
    "tk.pinging": "🏓 Ping කරමින්...",
    "tk.pong": "🏓 *Pong!* {ms} ms",
    "tk.stats": "📊 *{bot}*\n\n⏱️ ක්‍රියාත්මක කාලය : {up}\n💾 මතකය : {mem} MB\n👥 Groups : {groups}\n🟢 Node : {node}",
    "tk.sltime": "🇱🇰 *ශ්‍රී ලංකා වේලාව*\n\n🕒 {d}",
    "tk.short_usage": "භාවිතය: {p}shorturl https://example.com/long/link",
    "tk.short_fail": "❌ Link එක කෙටි කළ නොහැකි විය.\n{msg}",
    "tk.heads": "ශීර්ෂය (HEADS)",
    "tk.tails": "අගය (TAILS)",
    "tk.choose_usage": "භාවිතය: {p}choose බත් | කොත්තු | බර්ගර්",
    "tk.choose_res": "🎯 මම තෝරන්නේ: *{x}*",
    "tk.ball_usage": "භාවිතය: {p}8ball මම සමත් වෙයිද?",
    "tk.truth_h": "🫢 *සත්‍යය (TRUTH)*",
    "tk.dare_h": "😈 *අභියෝගය (DARE)*",
    "tk.truths": [
      "මහජන ඉදිරිපිට ඔබ කළ ලජ්ජාසහගතම දේ මොකක්ද?",
      "ඔබේ පළමු crush කවුද?",
      "මේ group එකේ කිසිවෙකුටත් නොකී රහසක් මොකක්ද?",
      "ඔබ අන්තිමට කී බොරුව මොකක්ද?",
      "මේ group එකේ ජීවිතය මාරු කරගන්න කැමති කවුරුන් එක්කද?",
      "ඔබේ ලොකුම බය මොකක්ද?"
    ],
    "tk.dares": [
      "ඔබේ ප්‍රියතම ගීතය ගයමින් voice note එකක් යවන්න.",
      "පැයක් සඳහා ඔබේ WhatsApp status එක 'I love this bot' කරන්න.",
      "ඔබේ හොඳම යාළුවාට දැන්ම 'I miss you' කියා පණිවිඩයක් යවන්න.",
      "Gallery එකේ තියෙන අන්තිම ඡායාරූපය යවන්න.",
      "ඉදිරි විනාඩි 10 emojis වලින් විතරක් කතා කරන්න.",
      "Voice note එකකින් හෝඩිය පිළිවෙලින් පසුපසට කියන්න."
    ],
    "tk.ball": [
      "ඔව් ✅", "නැහැ ❌", "සමහරවිට 🤔", "නිසැකවම 💯",
      "පසුව නැවත අහන්න ⏳", "මම එහෙම හිතන්නේ නැහැ 🙅", "අනිවාර්යයෙන්ම 🔥", "කිසිම ඉඩක් නැහැ 🚫"
    ]
  }
};

// settings menu: section titles + item labels (සිංහල) — settings.js එකෙන් පාවිච්චි වෙනවා
DICT.en["lbl.1.7"] = "Language";
DICT.si["lbl.1.7"] = "භාෂාව";

const SI_LABELS = {
  "sec.🌐 GENERAL": "🌐 සාමාන්‍ය",
  "sec.🤖 AUTO": "🤖 ස්වයංක්‍රීය",
  "sec.📱 STATUS": "📱 STATUS",
  "sec.👥 GROUP": "👥 GROUP",
  "sec.🎨 MEDIA": "🎨 මාධ්‍ය",
  "sec.🛡️ PROTECTION": "🛡️ ආරක්ෂාව",
  "sec.🚦 CONTROL": "🚦 පාලනය",
  "sec.⚡ SYSTEM": "⚡ පද්ධතිය",
  "lbl.1.4": "Prefix",
  "lbl.1.5": "චැට් මාදිලිය",
  "lbl.1.6": "තහනම් පරිශීලකයින්",
  "lbl.2.1": "ස්වයං Seen",
  "lbl.2.2": "ස්වයං React",
  "lbl.2.3": "ස්වයං Typing",
  "lbl.2.4": "ස්වයං පිළිතුර",
  "lbl.2.5": "Typing ආකාරය",
  "lbl.2.6": "පිළිතුරු පරතරය",
  "lbl.2.7": "පිළිතුරු පෙළ",
  "lbl.6.1": "Status Seen",
  "lbl.6.2": "Status React",
  "lbl.6.3": "React ආකාරය",
  "lbl.6.4": "React Emoji",
  "lbl.6.5": "අහඹු Emojis",
  "lbl.3.1": "ආයුබෝවන් පණිවිඩය",
  "lbl.3.2": "සමුගැනීමේ පණිවිඩය",
  "lbl.3.9": "Welcome පින්තූරය",
  "lbl.3.10": "Welcome පෙළ",
  "lbl.3.11": "Goodbye පෙළ",
  "lbl.3.3": "Anti Link",
  "lbl.3.12": "අවසර ලත් Links",
  "lbl.3.5": "Anti Badword",
  "lbl.3.13": "තහනම් වචන",
  "lbl.3.4": "Anti Spam",
  "lbl.3.8": "Spam සීමාව",
  "lbl.3.6": "දඬුවම",
  "lbl.3.7": "අනතුරු ඇඟවීම් සීමාව",
  "lbl.4.1": "Sticker",
  "lbl.4.2": "බාගත කිරීම",
  "lbl.4.3": "Auto Crop",
  "lbl.4.4": "Sticker Pack",
  "lbl.4.5": "Sticker Author",
  "lbl.7.1": "Anti Delete",
  "lbl.7.2": "මැකූ පණිවිඩ යවන්නේ",
  "lbl.7.3": "Anti ViewOnce",
  "lbl.7.4": "Anti Call",
  "lbl.7.5": "අමතන්නන් Block",
  "lbl.7.6": "ඇමතුම් පණිවිඩය",
  "lbl.5.1": "නැවත සම්බන්ධ වීම",
  "lbl.5.2": "Debug",
  "lbl.5.3": "Always Online",
  "lbl.8.1": "නඩත්තු මාදිලිය",
  "lbl.8.2": "නඩත්තු පණිවිඩය",
  "lbl.8.3": "Command පරතරය",
  "lbl.8.4": "Anti Fake",
  "lbl.8.5": "අවසර ලත් රට කේත"
};

Object.assign(DICT.si, SI_LABELS);

/* =====================================================
   DOWNLOADERS (dlcore.js — tiktok / facebook / youtube / instagram)
===================================================== */

Object.assign(DICT.en, {
  "dl.usage": "{icon} *{title} DOWNLOADER*\n\nUsage:\n{p}{cmd} <link>\n\nExample:\n{p}{cmd} {example}",
  "dl.invalid_link": "❌ Please send a valid {title} link.",
  "dl.info": "MEDIA INFORMATION",
  "dl.f_title": "Title",
  "dl.f_author": "Author",
  "dl.f_duration": "Duration",
  "dl.select": "SELECT QUALITY",
  "dl.opt_audio": "Audio (MP3)",
  "dl.opt_images": "Photos",
  "dl.reply1": "↪ Reply with a number (e.g. 2)",
  "dl.reply2": "↪ Add d for document (e.g. 2d)",
  "dl.send_as": "SEND AS",
  "dl.type_video": "Video",
  "dl.type_audio": "Audio",
  "dl.type_doc": "Document",
  "dl.reply12": "↪ Reply with 1 or 2",
  "dl.bad_number": "❌ Choose a number from 1 to {n}.",
  "dl.busy": "⏳ A download is already running in this chat. Please wait.",
  "dl.too_large": "⚠️ This file is too large ({size}). The limit is {max}MB.\n\nChoose a lower quality.",
  "dl.private": "🔒 This content is private, age-restricted or needs a login.",
  "dl.no_tool": "❌ The downloader tool (yt-dlp) is not available on this server.\n\n{msg}",
  "dl.fail": "❌ Download failed.\n\n{msg}",
  "dl.premium": "💎 This is a Premium feature.\n\nContact the owner or a bot admin to get Premium."
});

Object.assign(DICT.si, {
  "dl.usage": "{icon} *{title} DOWNLOADER*\n\nභාවිතය:\n{p}{cmd} <link>\n\nඋදාහරණය:\n{p}{cmd} {example}",
  "dl.invalid_link": "❌ කරුණාකර වලංගු {title} link එකක් යවන්න.",
  "dl.info": "මාධ්‍ය තොරතුරු",
  "dl.f_title": "මාතෘකාව",
  "dl.f_author": "නිර්මාණකරු",
  "dl.f_duration": "කාලය",
  "dl.select": "තත්ත්වය (QUALITY) තෝරන්න",
  "dl.opt_audio": "Audio (MP3)",
  "dl.opt_images": "ඡායාරූප",
  "dl.reply1": "↪ ඉලක්කමක් reply කරන්න (උදා: 2)",
  "dl.reply2": "↪ Document ලෙස ගැනීමට d එකතු කරන්න (උදා: 2d)",
  "dl.send_as": "යවන ආකාරය",
  "dl.type_video": "Video",
  "dl.type_audio": "Audio",
  "dl.type_doc": "Document",
  "dl.reply12": "↪ 1 හෝ 2 reply කරන්න",
  "dl.bad_number": "❌ 1 සිට {n} දක්වා ඉලක්කමක් තෝරන්න.",
  "dl.busy": "⏳ මේ chat එකේ බාගත කිරීමක් දැනටමත් සිදුවෙමින් පවතී. කරුණාකර රැඳී සිටින්න.",
  "dl.too_large": "⚠️ මේ ගොනුව ඉතා විශාලයි ({size}). සීමාව {max}MB යි.\n\nඅඩු තත්ත්වයක් තෝරන්න.",
  "dl.private": "🔒 මේ අන්තර්ගතය පුද්ගලිකයි, වයස් සීමා ඇත, හෝ login අවශ්‍යයි.",
  "dl.no_tool": "❌ බාගත කිරීමේ මෙවලම (yt-dlp) මේ server එකේ නැත.\n\n{msg}",
  "dl.fail": "❌ බාගත කිරීම අසාර්ථකයි.\n\n{msg}",
  "dl.premium": "💎 මෙය Premium අංගයකි.\n\nPremium ගැනීමට owner හෝ bot admin අමතන්න."
});

Object.assign(DESC_SI, {
  "Download TikTok video / audio (choose quality)": "TikTok video / audio බාගත කරන්න (quality තෝරන්න)",
  "Download Facebook video (choose quality)": "Facebook video බාගත කරන්න (quality තෝරන්න)",
  "Download Instagram reel / post (choose quality)": "Instagram reel / post බාගත කරන්න (quality තෝරන්න)",
  "Download YouTube video by link or name (choose quality)": "YouTube video link හෝ නමින් බාගත කරන්න (quality තෝරන්න)"
});
