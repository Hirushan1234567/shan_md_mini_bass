import fs from "fs";

const FILE = "./index.js";
const BACKUP = "./index.backup.js";

// කලින් patch එකක් කරලා තියෙනවා නම් original එකෙන් අලුතෙන් පටන් ගන්නවා
let src = fs.existsSync(BACKUP)
  ? fs.readFileSync(BACKUP, "utf8")
  : fs.readFileSync(FILE, "utf8");

if (!fs.existsSync(BACKUP)) fs.writeFileSync(BACKUP, src);

function must(label, ok) {
  if (!ok) {
    console.error(`❌ Patch failed at: ${label}`);
    process.exit(1);
  }
}

// 1) import
const imp = `import { t, langOf } from "./lang.js";`;
must("import", src.includes(imp));
src = src.replace(
  imp,
  imp + `\nimport { startApiServer, getOrCreateKey } from "./api.js";`
);

// 2) API server start
const mainA = `await connectMongo();\n  await expirePremiumUsers();`;
must("main()", src.includes(mainA));
src = src.replace(
  mainA,
  `await connectMongo();\n  startApiServer();\n  await expirePremiumUsers();`
);

// 3) Welcome text එකට key එක එකතු කරනවා
const bw = `function buildWelcomeText(number, prefix) {`;
must("buildWelcomeText", src.includes(bw));
src = src.replace(
  bw,
  `function buildWelcomeText(number, prefix, key = "") {
  const base = buildWelcomeTextBase(number, prefix);

  if (!key) {
    return base;
  }

  return (
    base +
    "\\n\\n🔑 *YOUR API KEY*\\n" +
    "\`\`\`" + key + "\`\`\`\\n" +
    "⚠️ Do not share this key with anyone."
  );
}

function buildWelcomeTextBase(number, prefix) {`
);

// 4) sendWelcomeMessage එකේ key එක ගන්නවා (main bot + sub-bots දෙකටම)
const cap = `const caption = buildWelcomeText(number, prefix);`;
must("caption", src.includes(cap));
src = src.replace(
  cap,
  `let apiKey = "";

  try {
    apiKey = (await getOrCreateKey(number)) || "";
  } catch (error) {
    console.error("❌ API key error:", error?.message || error);
  }

  const caption = buildWelcomeText(number, prefix, apiKey);`
);

fs.writeFileSync(FILE, src);
console.log("✅ index.js patched (key එක welcome message එකේ).");