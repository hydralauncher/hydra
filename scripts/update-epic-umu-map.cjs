const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash } = require("node:crypto");
const REQUEST_TIMEOUT_MS = 30_000;
const REPOSITORY = "Open-Wine-Components/umu-database";

function parseCsv(text) {
  const rows = [];
  let row = [],
    field = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const character = text[i];
    if (character === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = !quoted;
    } else if (character === "," && !quoted) {
      row.push(field);
      field = "";
    } else if (character === "\n" && !quoted) {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else field += character;
  }
  if (quoted) throw new Error("Unclosed CSV field");
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function generateMap(csv, commit) {
  if (!/^[a-f0-9]{40}$/.test(commit))
    throw new Error("Expected an immutable source commit");
  const [header, ...rows] = parseCsv(csv);
  const store = header.indexOf("STORE"),
    codename = header.indexOf("CODENAME"),
    id = header.indexOf("UMU_ID");
  if ([store, codename, id].some((index) => index < 0))
    throw new Error("Unsupported upstream CSV schema");
  const entries = {};
  for (const row of rows) {
    if (row[store]?.trim().toLowerCase() !== "egs") continue;
    const key = row[codename]?.trim().toLowerCase(),
      value = row[id]?.trim().toLowerCase();
    if (!key || !/^umu-[a-z0-9_-]+$/.test(value ?? ""))
      throw new Error("Invalid Epic mapping");
    if (entries[key] && entries[key] !== value)
      throw new Error(`Conflicting Epic mapping: ${key}`);
    entries[key] = value;
  }
  if (!Object.keys(entries).length) throw new Error("Epic map is empty");
  return {
    schemaVersion: 1,
    source: `https://github.com/${REPOSITORY}/blob/${commit}/umu-database.csv`,
    commit,
    csvSha256: createHash("sha256").update(csv).digest("hex"),
    license: "GPL-3.0-only",
    entries: Object.fromEntries(
      Object.entries(entries).sort(([left], [right]) =>
        left.localeCompare(right, "en")
      )
    ),
  };
}

async function fetchText(url) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: { "User-Agent": "Hydra-UMU-map-build" },
  });
  if (!response.ok) throw new Error(`UMU source HTTP ${response.status}`);
  return response.text();
}

async function main() {
  const commit =
    process.argv[2] ??
    JSON.parse(
      await fetchText(`https://api.github.com/repos/${REPOSITORY}/commits/main`)
    ).sha;
  const base = `https://raw.githubusercontent.com/${REPOSITORY}/${commit}`;
  const [csv, license] = await Promise.all([
    fetchText(`${base}/umu-database.csv`),
    fetchText(`${base}/LICENSE`),
  ]);
  const map = generateMap(csv, commit);
  const project = path.resolve(__dirname, "..");
  await fs.writeFile(
    path.join(project, "src/shared/epic-umu-map.json"),
    `${JSON.stringify(map, null, 2)}\n`
  );
  await fs.mkdir(path.join(project, "resources/epic"), { recursive: true });
  await fs.writeFile(
    path.join(project, "resources/epic/UMU-DATABASE-LICENSE"),
    license
  );
  await fs.writeFile(
    path.join(project, "resources/epic/UMU-DATABASE-NOTICE.md"),
    `# UMU database\n\nEpic-only mapping derived from ${map.source}.\nSource CSV SHA-256: ${map.csvSha256}.\nLicensed GPL-3.0-only; see UMU-DATABASE-LICENSE.\n`
  );
  process.stdout.write(
    `Generated ${Object.keys(map.entries).length} Epic mappings from ${commit}\n`
  );
}

module.exports = { parseCsv, generateMap };
if (require.main === module)
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
