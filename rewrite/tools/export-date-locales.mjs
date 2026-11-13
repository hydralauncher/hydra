// Exports date-fns' formatDistance wording for the locales Hydra uses
// (getDateLocale in src/shared/index.ts) so the rewrite prints the same
// "8 months ago" / "há 8 meses" strings. Output: crates/hydra-i18n/data/date-distance.json
//
// Each token maps counts to a template where the number is "{n}". Runs of
// counts with the same template collapse into [from, template] pairs.
// Usage (repo root, after `yarn install`): node rewrite/tools/export-date-locales.mjs
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const hydraRoot = path.resolve(here, "..", "..");
const require = createRequire(path.join(hydraRoot, "package.json"));
const locales = require("date-fns/locale");

// getDateLocale: language prefix -> date-fns locale (anything else: enUS).
const mapping = {
  pt: "ptBR", es: "es", fr: "fr", hu: "hu", pl: "pl", tr: "tr", ru: "ru", it: "it",
  be: "be", zh: "zhCN", da: "da", el: "el", vi: "vi", ja: "ja", sl: "sl", en: "enUS",
};

const tokens = [
  "lessThanXSeconds", "xSeconds", "halfAMinute", "lessThanXMinutes", "xMinutes",
  "aboutXHours", "xHours", "xDays", "aboutXWeeks", "xWeeks", "aboutXMonths",
  "xMonths", "aboutXYears", "xYears", "overXYears", "almostXYears",
];
const MAX = 120;

const compress = (render) => {
  const runs = [];
  for (let n = 1; n <= MAX; n++) {
    const text = render(n);
    const template = text.replace(new RegExp(`(?<![0-9])${n}(?![0-9])`), "{n}");
    if (!runs.length || runs[runs.length - 1][1] !== template) runs.push([n, template]);
  }
  return runs;
};

const out = { mapping, locales: {} };
for (const [prefix, name] of Object.entries(mapping)) {
  const locale = locales[name];
  if (!locale) throw new Error(`missing date-fns locale ${name}`);
  const entry = { past: {}, future: {}, plain: {} };
  for (const token of tokens) {
    entry.past[token] = compress((n) => locale.formatDistance(token, n, { addSuffix: true, comparison: -1 }));
    entry.future[token] = compress((n) => locale.formatDistance(token, n, { addSuffix: true, comparison: 1 }));
    entry.plain[token] = compress((n) => locale.formatDistance(token, n, {}));
  }
  out.locales[name] = entry;
}

const target = path.join(here, "..", "crates", "hydra-i18n", "data", "date-distance.json");
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, JSON.stringify(out));
console.log(`wrote ${target} (${fs.statSync(target).size} bytes)`);
