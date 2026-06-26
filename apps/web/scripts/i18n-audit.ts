#!/usr/bin/env ts-node
/**
 * i18n Audit Script
 *
 * Scans the web app codebase for:
 * 1. Hardcoded strings in JSX text nodes
 * 2. Toast/alert messages not wrapped in t()
 * 3. aria-label/title/placeholder attributes without t()
 * 4. Missing translation keys in overlays (zh-TW, ja, etc.)
 * 5. Keys present in zh/en but missing in overlay languages
 *
 * Usage: npx ts-node scripts/i18n-audit.ts
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const EXCLUDE_DIRS = new Set(["node_modules", ".next", "__tests__", "dist", "scripts"]);
const EXCLUDE_FILES = new Set(["i18n.ts"]);

interface AuditIssue {
  type: "hardcoded" | "missing_overlay" | "incomplete_overlay";
  file: string;
  line: number;
  key?: string;
  text: string;
  suggestion?: string;
}

function findTsxFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory() && !EXCLUDE_DIRS.has(entry.name)) {
      results.push(...findTsxFiles(p));
    } else if (entry.isFile() && (entry.name.endsWith(".tsx") || entry.name.endsWith(".ts"))) {
      if (EXCLUDE_FILES.has(entry.name)) continue;
      results.push(p);
    }
  }
  return results;
}

function scanHardcodedStrings(files: string[]): AuditIssue[] {
  const issues: AuditIssue[] = [];

  for (const file of files) {
    const content = fs.readFileSync(file, "utf8");
    const lines = content.split("\n");

    lines.forEach((line, idx) => {
      // Skip comments
      const codeLine = line.replace(/\/\/.*$/, "");

      // 1. Detect toast/alert calls with hardcoded strings
      const toastMatch = codeLine.match(/toast\.(info|success|error|warning)\(([^)]+)\)/);
      if (toastMatch) {
        const arg = toastMatch[2].trim();
        if (!arg.startsWith("t(") && !arg.startsWith("err") && (arg.includes('"') || arg.includes("'"))) {
          issues.push({
            type: "hardcoded",
            file: path.relative(".", file),
            line: idx + 1,
            text: arg.substring(0, 60),
            suggestion: `Wrap with t() or add to i18n dict`,
          });
        }
      }

      // 2. Detect aria-label, title, placeholder without t()
      const attrMatches = [...codeLine.matchAll(/\b(aria-label|title|placeholder)=\{?([^}]+)\}?/g)];
      for (const m of attrMatches) {
        const val = m[2].trim();
        if (val.startsWith('"') || val.startsWith("'")) {
          const unquoted = val.slice(1, -1);
          if (unquoted.length > 2 && !unquoted.startsWith("http") && !/^[\d\s%.,:;]+$/.test(unquoted)) {
            issues.push({
              type: "hardcoded",
              file: path.relative(".", file),
              line: idx + 1,
              text: `${m[1]}="${unquoted}"`,
              suggestion: `Add i18n key and use t("key")`,
            });
          }
        }
      }

      // 3. Detect JSX text nodes with Chinese characters (outside t())
      const jsxMatches = [...codeLine.matchAll(/>\s*([一-鿿][^<]*)</g)];
      for (const m of jsxMatches) {
        const text = m[1].trim();
        if (text.length > 0 && text !== " " && !/^\d/.test(text)) {
          const before = codeLine.substring(0, m.index);
          // Skip if inside t() or style/URL
          if (before.includes("t(") && !before.includes(")")) continue;
          issues.push({
            type: "hardcoded",
            file: path.relative(".", file),
            line: idx + 1,
            text: text.substring(0, 40),
            suggestion: `Extract to i18n dict`,
          });
        }
      }
    });
  }

  return issues;
}

function scanMissingOverlayKeys(): AuditIssue[] {
  const issues: AuditIssue[] = [];
  const i18nPath = path.join(__dirname, "..", "lib", "i18n.ts");
  const content = fs.readFileSync(i18nPath, "utf8");

  // Extract all keys from main dict
  const mainKeys = new Set<string>();
  const mainMatches = [...content.matchAll(/^\s+"([\w.]+)":\s*\{\s*zh:/gm)];
  mainMatches.forEach(m => mainKeys.add(m[1]));

  // Extract overlay sections
  const overlays = ["zh-TW", "ja", "es", "ar", "fr", "pt", "it", "ko", "th", "vi"];
  for (const lang of overlays) {
    const re = new RegExp(`"${lang}":\\s*\\{([\\s\\S]*?)\\n\\s*\\}`, "g");
    const match = re.exec(content);
    if (!match) continue;

    const overlayKeys = new Set<string>();
    const keyMatches = [...match[1].matchAll(/"([\w.]+)":/g)];
    keyMatches.forEach(m => overlayKeys.add(m[1]));

    for (const key of mainKeys) {
      if (!overlayKeys.has(key)) {
        issues.push({
          type: "incomplete_overlay",
          file: "lib/i18n.ts",
          line: 0,
          key,
          text: `Missing in ${lang} overlay`,
          suggestion: `Add "${key}" to ${lang} overlay`,
        });
      }
    }
  }

  return issues;
}

function main() {
  console.log("=== i18n Audit Report ===\n");

  const files = findTsxFiles(path.join(__dirname, "..", "app"))
    .concat(findTsxFiles(path.join(__dirname, "..", "components")))
    .concat(findTsxFiles(path.join(__dirname, "..", "lib")));

  const hardcodedIssues = scanHardcodedStrings(files);
  const overlayIssues = scanMissingOverlayKeys();

  if (hardcodedIssues.length > 0) {
    console.log(`[Hardcoded Strings] ${hardcodedIssues.length} issues found:\n`);
    hardcodedIssues.forEach(i => {
      console.log(`  ${i.file}:${i.line} ${i.text}`);
      console.log(`    -> ${i.suggestion}`);
    });
    console.log("");
  }

  if (overlayIssues.length > 0) {
    // Group by language
    const byLang = new Map<string, AuditIssue[]>();
    overlayIssues.forEach(i => {
      const lang = i.text.replace("Missing in ", "").replace(" overlay", "");
      if (!byLang.has(lang)) byLang.set(lang, []);
      byLang.get(lang)!.push(i);
    });

    console.log(`[Missing Overlay Keys] ${overlayIssues.length} issues found:\n`);
    for (const [lang, issues] of byLang) {
      console.log(`  ${lang}: ${issues.length} missing keys`);
      issues.slice(0, 10).forEach(i => console.log(`    - ${i.key}`));
      if (issues.length > 10) console.log(`    ... and ${issues.length - 10} more`);
    }
    console.log("");
  }

  const total = hardcodedIssues.length + overlayIssues.length;
  console.log(`=== Summary: ${total} issues found ===`);

  // Write report to file
  const report = {
    timestamp: new Date().toISOString(),
    hardcoded: hardcodedIssues,
    overlay: overlayIssues,
  };
  fs.writeFileSync(path.join(__dirname, "..", "i18n-audit-report.json"), JSON.stringify(report, null, 2));
  console.log("Report written to i18n-audit-report.json");

  process.exit(total > 0 ? 1 : 0);
}

main();
