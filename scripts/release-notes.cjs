// Builds the draft release notes for the Release workflow. Asks GitHub for the
// same auto-generated changelog it produces today, then groups the bullet list
// into sections by conventional-commit prefix (feat, fix, chore, ci, ...).
// Bullets without a recognized prefix are kept verbatim under "What's Changed".
//
//   node scripts/release-notes.cjs [tag-name] [previous-tag]
//
// The tag defaults to v<package.json version>, matching the tags past hydra
// releases used. GITHUB_TOKEN must be set. Writes the notes to
// release-notes.md and, when GITHUB_OUTPUT is present, exposes
// tag_name=<tag-name>.
const fs = require("node:fs");

const SECTIONS = [
  { title: "Features", patterns: [/^feat\b/i, /^feature\b/i] },
  {
    title: "Bug Fixes",
    patterns: [/^fix\b/i, /^hotfix\b/i, /^bug\b/i, /^perf\b/i, /^revert\b/i],
  },
  {
    title: "Maintenance",
    patterns: [/^(chore|ci|build|refactor|test|docs|style)\b/i],
  },
];
const FALLBACK_TITLE = "Other Changes";

// "fix(friends-window): keep the clear button inside the input" -> "fix"
function bulletPrefix(line) {
  const text = line.replace(/^\s*[-*]\s+/, "");
  return /^[a-zA-Z]+(\([^)]*\))?!?:/.test(text) ? text.split(/[(:]/)[0] : null;
}

function groupBullets(markdown) {
  const lines = markdown.split("\n");
  const sections = new Map();
  const order = [];
  const push = (title, line) => {
    if (!sections.has(title)) {
      sections.set(title, []);
      order.push(title);
    }
    sections.get(title).push(line);
  };

  for (const line of lines) {
    if (!/^\s*[-*]\s+/.test(line)) {
      // Non-bullet lines keep their position, except the now-redundant
      // "## What's Changed" heading the sections replace, and
      // "## New Contributors", whose bullets land in "Other Changes".
      if (!/^##\s+(What's Changed|New Contributors)/i.test(line.trim()))
        push(null, line);
      continue;
    }
    const prefix = bulletPrefix(line);
    const section =
      prefix &&
      SECTIONS.find(({ patterns }) => patterns.some((p) => p.test(prefix)));
    push(section ? section.title : FALLBACK_TITLE, line);
  }

  // Sections keep their definition order; ungrouped lines keep the position
  // where they appeared in the generated notes.
  const known = order.filter((t) => t !== null);
  order.length = 0;
  for (const title of SECTIONS.map((s) => s.title))
    if (known.includes(title)) order.push(title);
  if (known.includes(FALLBACK_TITLE)) order.push(FALLBACK_TITLE);
  if (sections.has(null)) order.push(null);

  return order
    .map((title) => {
      const body = sections.get(title).join("\n").trim();
      if (title === null) return body;
      return body ? `### ${title}\n\n${body}` : null;
    })
    .filter(Boolean)
    .join("\n\n");
}

async function generateNotes(tagName, previousTag) {
  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  if (!repo || !token)
    throw new Error("GITHUB_REPOSITORY and GITHUB_TOKEN are required");

  const response = await fetch(
    `https://api.github.com/repos/${repo}/releases/generate-notes`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({
        tag_name: tagName,
        previous_tag_name: previousTag || undefined,
        // Generate against the commit being built (a release/** branch), not
        // the default branch, which is used when the tag doesn't exist yet.
        target_commitish: process.env.GITHUB_SHA || undefined,
      }),
    }
  );
  if (!response.ok)
    throw new Error(
      `GitHub generate-notes failed: ${response.status} ${await response.text()}`
    );
  return (await response.json()).body;
}

// Tags past releases used "v" + the version in package.json. On a
// release/v4.3.0 branch the tag is the branch suffix instead.
function defaultTagName() {
  const refName = process.env.GITHUB_REF_NAME || "";
  if (refName.startsWith("release/")) return refName.slice("release/".length);
  const { version } = JSON.parse(fs.readFileSync("package.json", "utf8"));
  return `v${version}`;
}

async function main() {
  const [tagArg, previousTag] = process.argv.slice(2);
  const tagName = tagArg || defaultTagName();

  const notes = groupBullets(await generateNotes(tagName, previousTag));
  fs.writeFileSync("release-notes.md", `${notes}\n`);
  if (process.env.GITHUB_OUTPUT)
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `tag_name=${tagName}\n`);
  console.log(`Wrote release notes for ${tagName} to release-notes.md`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = { groupBullets, bulletPrefix };
