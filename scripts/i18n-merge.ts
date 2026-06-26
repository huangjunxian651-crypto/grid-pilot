import * as fs from "fs";
import * as path from "path";

const I18N_PATH = path.join(process.cwd(), "apps/web/lib/i18n.ts");
const BATCH_DIR = path.join(process.cwd(), "scripts/.i18n-batch");

function merge() {
  let content = fs.readFileSync(I18N_PATH, "utf8");

  for (const file of fs.readdirSync(BATCH_DIR)) {
    if (!file.endsWith("-response.json")) continue;
    const lang = file.replace("-response.json", "");
    const translations = JSON.parse(fs.readFileSync(path.join(BATCH_DIR, file), "utf8"));

    // Find the lang overlay and replace its contents
    const regex = new RegExp(`("${lang}"\\s*:\\s*\\{)([\\s\\S]*?)(\\n\\s*\\})`, "g");
    const newEntries = Object.entries(translations)
      .map(([k, v]) => `    "${k}": "${(v as string).replace(/"/g, '\\"')}",`)
      .join("\n");

    content = content.replace(regex, `$1\n${newEntries}\n  }`);
    console.log(`Merged ${Object.keys(translations).length} keys for ${lang}`);
  }

  fs.writeFileSync(I18N_PATH, content);
  console.log("\ni18n.ts updated.");
}

merge();
