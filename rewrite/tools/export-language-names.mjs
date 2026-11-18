// Exports `Intl.DisplayNames(locale, { type: "language" })` for the languages a
// review can be written in, in every UI language Hydra ships, so the rewrite
// prints the same "translated from Portuguese" / "traduzido de inglês" labels
// as review-item.tsx (getLanguageDisplayName in src/shared/review-translation.ts).
// Output: crates/hydra-i18n/data/language-names.json
// Usage (repo root): node rewrite/tools/export-language-names.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const hydraRoot = path.resolve(here, "..", "..");
const localesDir = path.join(hydraRoot, "src", "locales");

// ISO 639-1 codes a language detector can report.
const codes = (
  "af am ar az be bg bn bs ca cs cy da de el en eo es et eu fa fi fil fr ga gl gu " +
  "he hi hr ht hu hy id is it ja jv ka kk km kn ko ku ky la lb lo lt lv mg mi mk ml " +
  "mn mr ms mt my nb ne nl nn no pa pl ps pt ro ru sd si sk sl sm sn so sq sr st su " +
  "sv sw ta te tg th tk tl tr tt ug uk ur uz vi xh yi yo zh zu"
).split(" ");

const out = {};
for (const locale of fs.readdirSync(localesDir).sort()) {
  if (!fs.existsSync(path.join(localesDir, locale, "translation.json"))) continue;
  let names;
  try {
    names = new Intl.DisplayNames([locale], { type: "language" });
  } catch {
    continue;
  }
  const table = {};
  for (const code of codes) {
    const name = names.of(code);
    if (name && name !== code) table[code] = name;
  }
  out[locale] = table;
}

const file = path.join(here, "..", "crates", "hydra-i18n", "data", "language-names.json");
fs.writeFileSync(file, JSON.stringify(out));
console.log(`exported ${codes.length} language names for ${Object.keys(out).length} locales to ${file}`);
