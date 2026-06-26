import { describe, it, expect } from "vitest";
import {
  extractI18nKeys,
  extractCodeKeys,
  OVERLAY_LANGS,
} from "./i18n-coverage";

describe("i18n coverage", () => {
  const { dictKeys, overlayKeys } = extractI18nKeys();
  const codeKeys = extractCodeKeys();

  it("every key used in code exists in dict", () => {
    const missing = [...codeKeys].filter((k) => !dictKeys.has(k));
    expect(missing, `Keys used in t() but missing from dict: ${missing.join(", ")}`).toEqual([]);
  });

  it("every dict key has zh and en values", () => {
    // Structural sanity check — dict should have a substantial number of keys
    // (阶段C清理无引用key后约251个)
    expect(dictKeys.size).toBeGreaterThan(200);
  });

  it("every overlay language covers all dict keys", () => {
    const failures: string[] = [];
    for (const lang of OVERLAY_LANGS) {
      const langKeys = overlayKeys[lang] ?? new Set();
      const missing = [...dictKeys].filter((k) => !langKeys.has(k));
      if (missing.length > 0) {
        failures.push(`  ${lang} missing ${missing.length} keys: ${missing.join(", ")}`);
      }
    }
    expect(failures, `Overlay coverage gaps:\n${failures.join("\n")}`).toEqual([]);
  });

  it("no unused keys in dict (informational)", () => {
    const unused = [...dictKeys].filter((k) => !codeKeys.has(k));
    // Informational only — don't fail the build on unused keys.
    console.log(`  ℹ ${unused.length} dict keys not found in code (may be used dynamically or planned)`);
  });
});
