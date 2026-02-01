import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const targetLang = process.argv[2];
if (!targetLang) {
  console.error(
    "Please provide a target language, e.g., 'node generate-missing-translations.js fr'"
  );
  process.exit(1);
}

const projectRoot = path.resolve(__dirname, "..");
const enPath = path.join(projectRoot, "locales/en/translation.json");
const targetDir = path.join(projectRoot, `locales/${targetLang}`);
const targetTranslationPath = path.join(targetDir, "translation.json");
const missingKeysPath = path.join(targetDir, "missing_keys.json");

const en = JSON.parse(fs.readFileSync(enPath, "utf8"));

let target = {};
try {
  target = JSON.parse(fs.readFileSync(targetTranslationPath, "utf8"));
} catch {
  console.warn(`No translation.json for '${targetLang}', starting empty.`);
}

function mergeMissing(enObj, targetObj) {
  const missing = {};
  for (const key in enObj) {
    if (!(key in targetObj)) {
      missing[key] = enObj[key];
    } else if (
      typeof enObj[key] === "object" &&
      enObj[key] !== null &&
      !Array.isArray(enObj[key])
    ) {
      const childMissing = mergeMissing(enObj[key], targetObj[key]);
      if (Object.keys(childMissing).length > 0) missing[key] = childMissing;
    }
  }
  return missing;
}

const missingKeysObj = mergeMissing(en, target);

fs.mkdirSync(targetDir, { recursive: true });
fs.writeFileSync(
  missingKeysPath,
  JSON.stringify(missingKeysObj, null, 2),
  "utf8"
);

console.log(`File '${missingKeysPath}' generated.`);
