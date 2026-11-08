// Exports the exact icons Hydra's renderer uses (octicons, phosphor, lucide)
// to SVG files so the Slint UI renders the same glyphs. Add entries as more
// screens are ported.
// Usage (from the repo root, after `yarn install`): node rewrite/tools/export-icons.mjs
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
// The Hydra repo root (this script lives in rewrite/tools).
const hydraRoot = path.resolve(process.argv[2] ?? path.join(here, "..", ".."));
const require = createRequire(path.join(hydraRoot, "package.json"));
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const oct = require("@primer/octicons-react");
const lucide = require("lucide-react");
const phosphor = await import(
  pathToFileURL(path.join(hydraRoot, "node_modules/@phosphor-icons/react/dist/index.es.js")).href
);

const out = path.join(here, "..", "crates", "hydra-desktop", "ui", "icons");
fs.mkdirSync(out, { recursive: true });

const icons = {
  play: [oct.PlayIcon, { size: 16 }],
  "plus-circle": [oct.PlusCircleIcon, { size: 16 }],
  heart: [oct.HeartIcon, { size: 16 }],
  "heart-fill": [oct.HeartFillIcon, { size: 16 }],
  pin: [oct.PinIcon, { size: 16 }],
  "pin-slash": [oct.PinSlashIcon, { size: 16 }],
  gear: [oct.GearIcon, { size: 16 }],
  pencil: [oct.PencilIcon, { size: 16 }],
  "chevron-down": [oct.ChevronDownIcon, { size: 16 }],
  "chevron-up": [oct.ChevronUpIcon, { size: 16 }],
  "chevron-left": [oct.ChevronLeftIcon, { size: 36 }],
  "chevron-right": [oct.ChevronRightIcon, { size: 36 }],
  "link-external": [oct.LinkExternalIcon, { size: 12 }],
  download: [oct.DownloadIcon, { size: 16 }],
  people: [oct.PeopleIcon, { size: 16 }],
  star: [oct.StarIcon, { size: 16 }],
  "star-fill": [oct.StarFillIcon, { size: 16 }],
  x: [oct.XIcon, { size: 24 }],
  lock: [oct.LockIcon, { size: 24 }],
  clock: [oct.ClockIcon, { size: 16 }],
  note: [oct.NoteIcon, { size: 24 }],
  alert: [oct.AlertIcon, { size: 16 }],
  "thumbsup-oct": [oct.ThumbsupIcon, { size: 16 }],
  "x-circle": [oct.XCircleIcon, { size: 16 }],
  "corners-out": [phosphor.CornersOut, { size: 24, weight: "bold" }],
  "corners-in": [phosphor.CornersIn, { size: 34, weight: "bold" }],
  "play-fill": [phosphor.Play, { size: 18, weight: "fill" }],
  "thumbs-up": [lucide.ThumbsUp, { size: 16 }],
  "thumbs-down": [lucide.ThumbsDown, { size: 16 }],
  "thumbs-up-fill": [lucide.ThumbsUp, { size: 16, fill: "currentColor" }],
  "thumbs-down-fill": [lucide.ThumbsDown, { size: 16, fill: "currentColor" }],
  reply: [oct.ReplyIcon, { size: 14 }],
  trash: [oct.TrashIcon, { size: 14 }],
  "star-lucide": [lucide.Star, { size: 18 }],
  "star-lucide-fill": [lucide.Star, { size: 18, fill: "currentColor" }],
  languages: [lucide.Languages, { size: 13 }],
  bold: [lucide.Bold, { size: 16 }],
  italic: [lucide.Italic, { size: 16 }],
  underline: [lucide.Underline, { size: 16 }],
  cloud: [oct.CloudIcon, { size: 16 }],
  check: [oct.CheckIcon, { size: 14 }],
  person: [oct.PersonIcon, { size: 40 }],
  "cloud-check": [phosphor.CloudCheck, { size: 22, weight: "fill" }],
  "cloud-arrow-up": [phosphor.CloudArrowUp, { size: 22, weight: "fill" }],
  "circle-notch": [phosphor.CircleNotch, { size: 22 }],
  pause: [phosphor.Pause, { size: 26, weight: "fill" }],
  "speaker-high": [phosphor.SpeakerHigh, { size: 26, weight: "fill" }],
  "speaker-low": [phosphor.SpeakerLow, { size: 26, weight: "fill" }],
  "speaker-x": [phosphor.SpeakerX, { size: 26, weight: "fill" }],
  "gear-six": [phosphor.GearSix, { size: 26, weight: "fill" }],
  "check-phosphor": [phosphor.Check, { size: 16, weight: "bold" }],
  "eye-closed": [oct.EyeClosedIcon, { size: 20 }],
  // App shell: title bar, navigation, sidebar (app-title-bar, navigation-arrows, sidebar/*)
  "arrow-left": [oct.ArrowLeftIcon, { size: 14 }],
  "arrow-right": [oct.ArrowRightIcon, { size: 14 }],
  search: [oct.SearchIcon, { size: 14 }],
  "x-small": [oct.XIcon, { size: 12 }],
  video: [oct.VideoIcon, { size: 14 }],
  dash: [oct.DashIcon, { size: 16 }],
  "screen-full": [oct.ScreenFullIcon, { size: 16 }],
  "screen-normal": [oct.ScreenNormalIcon, { size: 16 }],
  home: [oct.HomeIcon, { size: 16 }],
  apps: [oct.AppsIcon, { size: 16 }],
  book: [oct.BookIcon, { size: 16 }],
  "check-circle": [oct.CheckCircleIcon, { size: 16 }],
  "check-circle-fill": [oct.CheckCircleFillIcon, { size: 16 }],
  sliders: [oct.SlidersIcon, { size: 16 }],
  "sort-desc": [oct.SortDescIcon, { size: 16 }],
  stack: [oct.StackIcon, { size: 16 }],
  trophy: [oct.TrophyIcon, { size: 16 }],
  "device-desktop": [oct.DeviceDesktopIcon, { size: 16 }],
  hourglass: [oct.HourglassIcon, { size: 16 }],
  bell: [oct.BellIcon, { size: 16 }],
  "comment-discussion": [oct.CommentDiscussionIcon, { size: 16 }],
  "sign-out": [oct.SignOutIcon, { size: 16 }],
  "heart-fill-12": [oct.HeartFillIcon, { size: 12 }],
  "chevron-down-12": [oct.ChevronDownIcon, { size: 12 }],
  // Library page (library.tsx, library-game-card.tsx, toolbar menus)
  "clock-11": [oct.ClockIcon, { size: 11 }],
  "alert-fill-11": [oct.AlertFillIcon, { size: 11 }],
  "check-circle-fill-11": [oct.CheckCircleFillIcon, { size: 11 }],
  "trophy-13": [oct.TrophyIcon, { size: 13 }],
  "image-48": [oct.ImageIcon, { size: 48 }],
  "telescope-24": [oct.TelescopeIcon, { size: 24 }],
  "heart-24": [oct.HeartIcon, { size: 24 }],
  "file-directory-24": [oct.FileDirectoryIcon, { size: 24 }],
  "file-directory": [oct.FileDirectoryIcon, { size: 16 }],
  "search-24": [oct.SearchIcon, { size: 24 }],
  "sync-24": [oct.SyncIcon, { size: 24 }],
  sync: [oct.SyncIcon, { size: 16 }],
  plus: [oct.PlusIcon, { size: 16 }],
  filter: [oct.FilterIcon, { size: 16 }],
  square: [oct.SquareIcon, { size: 16 }],
  rows: [oct.RowsIcon, { size: 16 }],
  "lock-16": [oct.LockIcon, { size: 16 }],
  "lock-11": [oct.LockIcon, { size: 11 }],
  "eye-closed-11": [oct.EyeClosedIcon, { size: 11 }],
  "stack-14": [oct.StackIcon, { size: 14 }],
  "device-desktop-14": [oct.DeviceDesktopIcon, { size: 14 }],
  "file-zip-11": [oct.FileZipIcon, { size: 11 }],
  "database-11": [oct.DatabaseIcon, { size: 11 }],
  "check-circle-fill-12": [oct.CheckCircleFillIcon, { size: 12 }],
  "trophy-14": [oct.TrophyIcon, { size: 14 }],
  // Context menus (game-context-menu.tsx) and toasts
  "file-directory-fill": [oct.FileDirectoryFillIcon, { size: 16 }],
  link: [oct.LinkIcon, { size: 16 }],
  image: [oct.ImageIcon, { size: 16 }],
  "eye-closed-16": [oct.EyeClosedIcon, { size: 16 }],
  "trash-16": [oct.TrashIcon, { size: 16 }],
  "x-16": [oct.XIcon, { size: 16 }],
  "x-circle-fill": [oct.XCircleFillIcon, { size: 16 }],
  "alert-16": [oct.AlertIcon, { size: 16 }],
  // Catalogue (pagination, game items, filter sections)
  "lucide-chevron-left": [lucide.ChevronLeft, { size: 16, strokeWidth: 2.25, absoluteStrokeWidth: true }],
  "lucide-chevron-right": [lucide.ChevronRight, { size: 16, strokeWidth: 2.25, absoluteStrokeWidth: true }],
  "lucide-chevrons-left": [lucide.ChevronsLeft, { size: 18, strokeWidth: 2.25, absoluteStrokeWidth: true }],
  "lucide-chevrons-right": [lucide.ChevronsRight, { size: 18, strokeWidth: 2.25, absoluteStrokeWidth: true }],
  question: [oct.QuestionIcon, { size: 28 }],
};

for (const [name, [Icon, props]] of Object.entries(icons)) {
  if (!Icon) throw new Error(`missing icon ${name}`);
  let svg = renderToStaticMarkup(React.createElement(Icon, props));
  // Slint colorizes the alpha mask, so any opaque color works; use white.
  svg = svg.replace(/currentColor/g, "#ffffff");
  if (!svg.includes("xmlns=")) svg = svg.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
  if (!/fill="/.test(svg.split(">")[0])) svg = svg.replace("<svg", '<svg fill="#ffffff"');
  fs.writeFileSync(path.join(out, `${name}.svg`), svg);
}
console.log(`exported ${Object.keys(icons).length} icons to ${out}`);
