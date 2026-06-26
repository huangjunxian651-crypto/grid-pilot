import fs from "fs";
import path from "path";

const WEB_ROOT = path.resolve(__dirname, "../..");

/** Supported non-zh/en overlay languages */
export const OVERLAY_LANGS = [
  "zh-TW", "ja", "es", "ar", "fr", "pt", "it", "ko", "th", "vi",
] as const;

/**
 * Parse i18n.ts and extract all dict keys and per-language overlay keys.
 */
export function extractI18nKeys() {
  const i18nPath = path.join(WEB_ROOT, "lib/i18n.ts");
  const content = fs.readFileSync(i18nPath, "utf-8");

  // Extract dict keys: lines like  "common.save": { zh: ..., en: ... },
  const dictStart = content.indexOf("const dict:");
  const dictEnd = content.indexOf("const overlays:");
  const dictSection = content.slice(dictStart, dictEnd);
  const dictKeys = new Set(
    [...dictSection.matchAll(/^\s+"([^"]+)":\s*\{/gm)].map((m) => m[1])
  );

  // Extract overlay keys per language
  const overlaySection = content.slice(dictEnd);
  const overlayKeys: Record<(typeof OVERLAY_LANGS)[number], Set<string>> = {} as Record<(typeof OVERLAY_LANGS)[number], Set<string>>;

  for (const lang of OVERLAY_LANGS) {
    const pattern = new RegExp(`"${lang}":\\s*\\{`);
    const match = pattern.exec(overlaySection);
    if (!match) {
      overlayKeys[lang] = new Set();
      continue;
    }

    // Walk braces to find the end of this language block
    let depth = 0;
    const start = match.index + match[0].length;
    let end = start;
    let inString = false;
    let escapeNext = false;
    for (let i = start; i < overlaySection.length; i++) {
      const ch = overlaySection[i];
      if (escapeNext) {
        escapeNext = false;
        continue;
      }
      if (ch === "\\") {
        escapeNext = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (ch === "{") depth++;
      else if (ch === "}") {
        if (depth === 0) { end = i; break; }
        depth--;
      }
    }

    const langBlock = overlaySection.slice(start, end);
    overlayKeys[lang] = new Set(
      [...langBlock.matchAll(/"([^"]+)":\s*"/g)].map((m) => m[1])
    );
  }

  return { dictKeys, overlayKeys };
}

/**
 * Scan all .tsx/.ts source files for t("some.key") and t(`prefix.${var}`) call sites.
 * Returns the set of unique translation keys (or dynamic prefixes) used in code.
 */
export function extractCodeKeys(): Set<string> {
  const keys = new Set<string>();
  const dirs = ["app", "components"];

  for (const dir of dirs) {
    const dirPath = path.join(WEB_ROOT, dir);
    if (!fs.existsSync(dirPath)) continue;
    walkDir(dirPath, (filePath) => {
      if (!filePath.endsWith(".tsx") && !filePath.endsWith(".ts")) return;
      if (filePath.includes("__tests__")) return;
      const content = fs.readFileSync(filePath, "utf-8");
      // Static string calls: t("key")
      for (const m of content.matchAll(/\bt\(\s*"([^"]+)"/g)) {
        keys.add(m[1]);
      }
      // Template literal calls: t(`prefix.${var}`) — extract prefix before ${
      for (const m of content.matchAll(/\bt\(\s*`([^$`]*)(?:\$\{[^}]*\})?/g)) {
        if (m[1] && m[1].endsWith(".")) continue; // skip dynamic prefixes like fsm. / dir.
        if (m[1]) keys.add(m[1]);
      }
    });
  }

  return keys;
}

function walkDir(dir: string, callback: (filePath: string) => void) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) walkDir(fullPath, callback);
    else callback(fullPath);
  }
}
