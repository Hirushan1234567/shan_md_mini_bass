// Shared download-result extractor for SHAN MINI BOT plugins.
// Returns a normalized shape consumed by plugins/Dl.js.
const URL_RE = /^https?:\/\//i;
const FILE_EXT_RE = /\.(?:apk|zip|rar|7z|pdf|mp4|mp3|m4a|jpg|jpeg|png|webp)(?:[?#]|$)/i;
const DOWNLOAD_KEYS = new Set(["url","link","href","download","downloadurl","download_url","file","direct","directurl","direct_url"]);

function collect(node, out, seen, depth = 0) {
  if (!node || typeof node !== "object" || depth > 8 || seen.has(node)) return;
  seen.add(node);
  if (Array.isArray(node)) {
    for (const item of node) collect(item, out, seen, depth + 1);
    return;
  }
  const pairs = Object.entries(node);
  const urlPair = pairs.find(([key, value]) =>
    DOWNLOAD_KEYS.has(key.toLowerCase()) &&
    typeof value === "string" && URL_RE.test(value.trim())
  );
  if (urlPair) {
    const [key, url] = urlPair;
    out.push({
      url: url.trim(),
      name: String(node.name || node.title || node.filename || node.fileName || ""),
      type: key.toLowerCase()
    });
  }
  for (const value of Object.values(node)) {
    if (value && typeof value === "object") collect(value, out, seen, depth + 1);
  }
}

export function extract(data, query = "", fallbackKind = "unknown") {
  const items = [];
  collect(data, items, new WeakSet());
  const unique = [...new Map(items.map(item => [item.url, item])).values()];
  const hasFile = unique.some(item =>
    FILE_EXT_RE.test(item.url) ||
    /download|file|direct/i.test(item.type)
  );
  return {
    kind: hasFile ? "file" : (unique.length ? fallbackKind : "unknown"),
    items: unique,
    query: String(query || "")
  };
}

export default extract;
