import * as fs from "fs";
import * as path from "path";

const I18N_PATH = path.join(process.cwd(), "apps/web/lib/i18n.ts");

interface TranslationEntry {
  key: string;
  zh: string;
  en: string;
}

function extractDict(content: string): TranslationEntry[] {
  const matches = [...content.matchAll(/^\s+"([a-zA-Z_][\w.]*)":\s*\{\s*zh:\s*"([^"]*)"\s*,\s*en:\s*"([^"]*)"\s*\}/gm)];
  return matches.map((m) => ({ key: m[1], zh: m[2], en: m[3] }));
}

function extractOverlayKeys(content: string, lang: string): Set<string> {
  const regex = new RegExp(`"${lang}"\\s*:\\s*\\{`, "g");
  const match = regex.exec(content);
  if (!match) return new Set();

  const startIdx = match.index;
  let braceCount = 0, inString = false, escapeNext = false, endIdx = startIdx;
  for (let i = startIdx; i < content.length; i++) {
    const ch = content[i];
    if (escapeNext) { escapeNext = false; continue; }
    if (ch === "\\") { escapeNext = true; continue; }
    if (ch === '"' && !escapeNext) { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") braceCount++;
    else if (ch === "}") { braceCount--; if (braceCount === 0) { endIdx = i; break; } }
  }

  const section = content.substring(startIdx, endIdx + 1);
  const keys = [...section.matchAll(/^\s+"([a-zA-Z_][\w.]*)":\s*"/gm)];
  return new Set(keys.map((k) => k[1]));
}

const LANG_NAMES: Record<string, string> = {
  "zh-TW": "Traditional Chinese (Taiwan)",
  "ja": "Japanese",
  "es": "Spanish",
  "ar": "Arabic",
  "fr": "French",
  "pt": "Portuguese",
  "it": "Italian",
  "th": "Thai",
  "vi": "Vietnamese",
};

function generate() {
  const content = fs.readFileSync(I18N_PATH, "utf8");
  const dict = extractDict(content);
  const outDir = path.join(process.cwd(), "scripts/.i18n-batch");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  for (const lang of Object.keys(LANG_NAMES)) {
    const covered = extractOverlayKeys(content, lang);
    const missing = dict.filter((e) => !covered.has(e.key));
    if (missing.length === 0) continue;

    const prompt = `Translate the following UI strings from English to ${LANG_NAMES[lang]}.
Preserve all placeholder syntax exactly: {n}, {total}, {price}, {date}, {dist}, {pct}, {mr}, {avail}, {gtc}, {cycles}, {count}, {lev}, {low}, {high}, {sideBest}, {step}, {ts}, {a}, {b}, {v}, etc.
Preserve all markup: $ prefix on variables like $\{price}, $\{v}, $\{step}.
Use concise, natural UI language suitable for a trading app.
Some terms like GridPilot, POC, GTC, Maker, Taker, Alpha, FSM, USDT, ETH are brand/technical terms — keep them in English.

Return ONLY a JSON object mapping each key to the translated string.

${JSON.stringify(
      Object.fromEntries(missing.map((e) => [e.key, e.en])),
      null,
      2
    )}`;

    fs.writeFileSync(path.join(outDir, `${lang}-prompt.txt`), prompt);
    console.log(`Generated ${lang}-prompt.txt (${missing.length} keys)`);
  }

  console.log(`\nPrompts written to ${outDir}/`);
  console.log("Feed each prompt to an LLM (Claude, GPT-4, etc.) to get translations.");
  console.log("Save the LLM output as {lang}-response.json and run the merge step.");
}

generate();
