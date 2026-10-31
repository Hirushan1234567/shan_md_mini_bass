/*
 * SHAN MINI BOT
 * Shared helper for APK search plugins.
 *
 * File: plugins/_dl.js
 * Files beginning with "_" are helper files, not commands.
 *
 * Compatible with:
 * plugin.command
 * plugin.commands
 * plugin.alias
 * plugin.execute(sock, msg, args, commandName)
 */

import { extract } from "./_download.js";

const BASE = "https://supunofc.site/api/search";

const API_KEY =
  process.env.DOWNLOAD_API_KEY ||
  "supun-xifv1g5uq3u82v45fnttjzwg";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const FOOTER = "_SHAN MINI BOT_";
const MAX_RESULTS = 10;

const isUrl = value =>
  /^https?:\/\//i.test(String(value || ""));

export const isHttpUrl = value =>
  isUrl(String(value || "").trim());

export const isPackageId = value =>
  /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/i.test(
    String(value || "").trim()
  );

/* ============================================================
   API REQUEST
============================================================ */

export async function callSearch(path, params = {}) {
  const url = new URL(`${BASE}/${path}`);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  }

  url.searchParams.set("apikey", API_KEY);

  let lastError = "";

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": UA
        },
        signal: AbortSignal.timeout(30000)
      });

      const json = await response.json().catch(() => null);

      console.log(
        `[SHAN SEARCH] ${path} | Attempt ${attempt} | HTTP ${response.status}`
      );

      if (response.status >= 500 || response.status === 429) {
        lastError = `HTTP ${response.status}`;

        await new Promise(resolve =>
          setTimeout(resolve, 1000 * attempt)
        );

        continue;
      }

      if (!response.ok || !json) {
        throw new Error(`HTTP ${response.status}`);
      }

      if (json.success === false || json.status === false) {
        throw new Error(
          json.message ||
          json.error ||
          "API request failed"
        );
      }

      return json;

    } catch (error) {
      lastError = error?.message || String(error);

      if (
        attempt === 3 ||
        /API request failed|HTTP 4/.test(lastError)
      ) {
        break;
      }

      await new Promise(resolve =>
        setTimeout(resolve, 1000 * attempt)
      );
    }
  }

  throw new Error(lastError || "Request failed");
}

/* ============================================================
   RESPONSE HELPERS
============================================================ */

export const pickData = json =>
  json?.result ??
  json?.data ??
  json?.results ??
  json;

function pickText(object, keys) {
  if (!object || typeof object !== "object") {
    return "";
  }

  const lower = Object.fromEntries(
    Object.entries(object).map(([key, value]) => [
      key.toLowerCase(),
      value
    ])
  );

  for (const key of keys) {
    const value = lower[key];

    if (
      (typeof value === "string" ||
        typeof value === "number") &&
      String(value).trim() &&
      !isUrl(value)
    ) {
      return String(value).trim();
    }
  }

  return "";
}

function pickUrl(object, keys) {
  if (!object || typeof object !== "object") {
    return "";
  }

  const lower = Object.fromEntries(
    Object.entries(object).map(([key, value]) => [
      key.toLowerCase(),
      value
    ])
  );

  for (const key of keys) {
    if (isUrl(lower[key])) {
      return String(lower[key]).trim();
    }
  }

  return "";
}

function deepFind(node, keys, depth = 0) {
  if (
    !node ||
    typeof node !== "object" ||
    depth > 6
  ) {
    return "";
  }

  const direct = pickText(node, keys);

  if (direct) {
    return direct;
  }

  for (const value of Object.values(node)) {
    if (value && typeof value === "object") {
      const result = deepFind(
        value,
        keys,
        depth + 1
      );

      if (result) {
        return result;
      }
    }
  }

  return "";
}

function findList(node, depth = 0) {
  if (depth > 5 || !node) {
    return null;
  }

  if (Array.isArray(node)) {
    const objects = node.filter(
      value =>
        value &&
        typeof value === "object" &&
        !Array.isArray(value)
    );

    return objects.length ? objects : null;
  }

  if (typeof node === "object") {
    for (const value of Object.values(node)) {
      const result = findList(value, depth + 1);

      if (result) {
        return result;
      }
    }
  }

  return null;
}

/* ============================================================
   NORMALIZE SEARCH RESULT
============================================================ */

export function normalizeItem(item) {
  const link = pickUrl(item, [
    "url",
    "link",
    "href",
    "page",
    "detail",
    "details"
  ]);

  let pkg = pickText(item, [
    "package",
    "packagename",
    "package_name",
    "pkg",
    "appid",
    "id"
  ]);

  if (!isPackageId(pkg)) {
    pkg = "";
  }

  if (!pkg && link) {
    try {
      const last =
        new URL(link).pathname
          .split("/")
          .filter(Boolean)
          .pop() || "";

      if (isPackageId(last)) {
        pkg = last;
      }
    } catch {}
  }

  return {
    title:
      pickText(item, [
        "title",
        "name",
        "app_name",
        "appname"
      ]) || "Unknown",

    pkg,

    version: pickText(item, [
      "version",
      "ver",
      "latest_version"
    ]),

    size: pickText(item, [
      "size",
      "filesize",
      "file_size"
    ]),

    developer: pickText(item, [
      "developer",
      "author",
      "publisher",
      "dev"
    ]),

    rating: pickText(item, [
      "rating",
      "score",
      "stars"
    ]),

    link,

    icon: pickUrl(item, [
      "icon",
      "image",
      "img",
      "thumbnail",
      "thumb",
      "cover",
      "logo"
    ])
  };
}

/* ============================================================
   FORMAT SEARCH RESULTS
============================================================ */

function formatResults(items, cfg, query) {
  const lines = items.map((raw, index) => {
    const item = normalizeItem(raw);

    const metadata = [
      item.version && `🏷️ ${item.version}`,
      item.size && `📦 ${item.size}`,
      item.rating && `⭐ ${item.rating}`
    ]
      .filter(Boolean)
      .join("  ");

    const hint = cfg.hint?.(item);

    return [
      `*${index + 1}.* ${item.title}`,
      item.developer && `   👤 ${item.developer}`,
      metadata && `   ${metadata}`,
      item.pkg && `   🆔 ${item.pkg}`,
      item.link && `   🔗 ${item.link}`,
      hint && `   ↳ ${hint}`
    ]
      .filter(Boolean)
      .join("\n");
  });

  return [
    `${cfg.icon || "🔎"} *${cfg.title || "APP SEARCH"}*`,
    `🔎 _${query}_`,
    "",
    lines.join("\n\n"),
    "",
    FOOTER
  ].join("\n");
}

/* ============================================================
   APP DETAILS
============================================================ */

function describeDetail(data, found) {
  const title =
    deepFind(data, [
      "title",
      "name",
      "app_name",
      "appname"
    ]) || "App";

  const fields = [
    ["👤", ["developer", "author", "publisher"]],
    ["🏷️", ["version", "latest_version", "ver"]],
    ["📦", ["size", "filesize", "file_size"]],
    ["⭐", ["rating", "score"]],
    ["⬇️", ["installs", "downloads"]],
    ["🤖", ["android", "requires", "min_android", "requirements"]],
    ["🗓️", ["updated", "last_updated", "update", "date"]],
    ["🆔", ["package", "packagename", "package_name"]]
  ];

  const lines = fields
    .map(([icon, keys]) => {
      const value = deepFind(data, keys);

      return value ? `${icon} ${value}` : "";
    })
    .filter(Boolean);

  const description = deepFind(data, [
    "description",
    "desc",
    "about",
    "summary"
  ]);

  const download =
    found?.items?.[0] &&
    ["file", "unknown"].includes(found.kind)
      ? found.items[0].url
      : "";

  const caption = [
    `📱 *${title}*`,
    ...lines,
    description
      ? `\n📝 ${description
          .replace(/\s+/g, " ")
          .slice(0, 350)}${
          description.length > 350 ? "…" : ""
        }`
      : "",
    "",
    FOOTER
  ]
    .filter((line, index, array) =>
      line !== "" || array[index - 1] !== ""
    )
    .join("\n");

  return {
    title,
    caption,
    download
  };
}

/* ============================================================
   PLUGIN FACTORY — SHAN MINI BOT INDEX.JS
============================================================ */

export function makeSearchPlugin(cfg) {
  const commandName = String(
    cfg.pattern || ""
  )
    .trim()
    .toLowerCase();

  const aliases = Array.isArray(cfg.aliases)
    ? cfg.aliases
    : [];

  const commands = [
    commandName,
    ...aliases
  ]
    .map(value =>
      String(value || "").trim().toLowerCase()
    )
    .filter(Boolean);

  return {
    command: commandName,
    commands,
    alias: aliases,

    description:
      cfg.title || "APK Search",

    category: "download",

    react: cfg.react || "🔎",

    async execute(sock, msg, args, commandName) {
      const from = msg?.key?.remoteJid;

      if (!from || !msg?.key) {
        return;
      }

      const settings =
        globalThis.SHAN_GET_SETTINGS?.() || {};

      const prefix =
        settings.prefix ||
        process.env.PREFIX ||
        ".";

      const reply = async text => {
        return sock.sendMessage(
          from,
          {
            text: String(text)
          },
          {
            quoted: msg
          }
        );
      };

      const raw = (
        Array.isArray(args) ? args : []
      )
        .join(" ")
        .trim();

      if (!raw) {
        const usage = String(
          cfg.usage || "{p}" + commandName + " <app name>"
        ).replaceAll("{p}", prefix);

        return reply(
          `${cfg.icon || "🔎"} *${cfg.title || "APP SEARCH"}*\n\n` +
          `Usage: ${usage}`
        );
      }

      try {
        /* ---------------- DETAIL MODE ---------------- */

        if (cfg.detail?.match(raw)) {
          const json = await callSearch(
            cfg.detail.path,
            cfg.detail.params(raw)
          );

          const data = pickData(json);

          const found = extract(
            data,
            raw,
            "file"
          );

          const {
            title,
            caption,
            download
          } = describeDetail(data, found);

          const text = download
            ? `${caption}\n\n🔗 ${download}`
            : caption;

          if (
            download &&
            found?.kind === "file"
          ) {
            try {
              const ext =
                (
                  new URL(download)
                    .pathname
                    .match(/\.([a-z0-9]{2,5})$/i) || []
                )[1] || "apk";

              const safeTitle =
                title
                  .replace(/[\\/:*?"<>|\n]/g, "")
                  .trim()
                  .slice(0, 60) || "app";

              await sock.sendMessage(
                from,
                {
                  document: {
                    url: download
                  },

                  mimetype:
                    ext.toLowerCase() === "apk"
                      ? "application/vnd.android.package-archive"
                      : "application/octet-stream",

                  fileName: `${safeTitle}.${ext}`,

                  caption
                },
                {
                  quoted: msg
                }
              );

              return;
            } catch (error) {
              console.error(
                `[${commandName}] File send failed:`,
                error?.message || error
              );
            }
          }

          if (found?.thumb) {
            try {
              await sock.sendMessage(
                from,
                {
                  image: {
                    url: found.thumb
                  },
                  caption: text
                },
                {
                  quoted: msg
                }
              );

              return;
            } catch {}
          }

          return reply(text);
        }

        /* ---------------- SEARCH MODE ---------------- */

        const searchPath = cfg.search?.path;

        if (!searchPath) {
          return reply(
            "Search configuration is missing."
          );
        }

        const json = await callSearch(
          searchPath,
          {
            [cfg.search.param || "q"]: raw
          }
        );

        const list = findList(
          pickData(json)
        );

        if (!list?.length) {
          return reply(
            `❌ No results found for "${raw}".`
          );
        }

        const items = list.slice(
          0,
          MAX_RESULTS
        );

        const text = formatResults(
          items,
          cfg,
          raw
        );

        const firstIcon =
          normalizeItem(items[0]).icon;

        if (
          firstIcon &&
          cfg.showIcon !== false
        ) {
          try {
            await sock.sendMessage(
              from,
              {
                image: {
                  url: firstIcon
                },
                caption: text
              },
              {
                quoted: msg
              }
            );

            return;
          } catch {}
        }

        return reply(text);

      } catch (error) {
        console.error(
          `[${commandName}] Search error:`,
          error?.message || error
        );

        return reply(
          "❌ Search failed. Please try again later." +
          (
            error?.message
              ? `\n_${error.message}_`
              : ""
          )
        );
      }
    }
  };
}