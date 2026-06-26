import * as fs from "fs";
import * as path from "path";

const I18N_PATH = path.join(process.cwd(), "apps/web/lib/i18n.ts");

interface AuditResult {
  lang: string;
  covered: number;
  total: number;
  missing: string[];
}

function extractDictKeys(content: string): string[] {
  // Only match dict entries (have { zh: ... } or { en: ... }), not overlay language keys
  const matches = [...content.matchAll(/^\s+"([a-zA-Z_][\w.]*)":\s*\{\s*(?:zh|en)\s*:/gm)];
  return matches.map((m) => m[1]);
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

function audit(): AuditResult[] {
  const content = fs.readFileSync(I18N_PATH, "utf8");
  const allKeys = extractDictKeys(content);
  const overlayLangs = ["zh-TW", "ja", "es", "ar", "fr", "pt", "it", "ko", "th", "vi"];

  return overlayLangs.map((lang) => {
    const covered = extractOverlayKeys(content, lang);
    const missing = allKeys.filter((k) => !covered.has(k));
    return { lang, covered: covered.size, total: allKeys.length, missing };
  });
}

const results = audit();
let exitCode = 0;
for (const r of results) {
  const pct = ((r.covered / r.total) * 100).toFixed(1);
  const status = r.covered === r.total ? "✓" : "✗";
  console.log(`${status} ${r.lang}: ${r.covered}/${r.total} (${pct}%)`);
  if (r.missing.length > 0) {
    console.log(`  Missing (${r.missing.length}): ${r.missing.slice(0, 10).join(", ")}${r.missing.length > 10 ? "..." : ""}`);
    exitCode = 1;
  }
}
process.exit(exitCode);
