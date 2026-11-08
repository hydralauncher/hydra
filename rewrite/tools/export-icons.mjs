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
  columns: [oct.ColumnsIcon, { size: 16 }],
  graph: [oct.GraphIcon, { size: 16 }],
  "more-vertical": [lucide.MoreVertical, { size: 16 }],
  "folder-open": [lucide.FolderOpen, { size: 16 }],
  "folder-open-14": [lucide.FolderOpen, { size: 14 }],
  camera: [lucide.Camera, { size: 16 }],
  "no-entry": [oct.NoEntryIcon, { size: 16 }],
  unmute: [oct.UnmuteIcon, { size: 16 }],
  mail: [oct.MailIcon, { size: 16 }],
  "download-24": [oct.DownloadIcon, { size: 24 }],
  "package-24": [oct.PackageIcon, { size: 24 }],
  "sync-24": [oct.SyncIcon, { size: 24 }],
  "trophy-24": [oct.TrophyIcon, { size: 24 }],
  "person-24": [oct.PersonIcon, { size: 24 }],
  "star-fill-24": [oct.StarFillIcon, { size: 24 }],
  "thumbsup-24": [oct.ThumbsupIcon, { size: 24 }],
  "comment-discussion-24": [oct.CommentDiscussionIcon, { size: 24 }],
  "gift-24": [oct.GiftIcon, { size: 24 }],
  "heart-fill-24": [oct.HeartFillIcon, { size: 24 }],
  "bell-24": [oct.BellIcon, { size: 24 }],
  "clock-12": [oct.ClockIcon, { size: 12 }],
  key: [oct.KeyIcon, { size: 16 }],
  "x-circle-fill": [oct.XCircleFillIcon, { size: 16 }],
  "question-12": [oct.QuestionIcon, { size: 12 }],
  "file-directory-14": [oct.FileDirectoryIcon, { size: 14 }],
  "history-14": [oct.HistoryIcon, { size: 14 }],
  "sync-12": [oct.SyncIcon, { size: 12 }],
  "shield-check": [oct.ShieldCheckIcon, { size: 16 }],
  "gamepad-2": [lucide.Gamepad2, { size: 16 }],
  "plus-lucide-14": [lucide.Plus, { size: 14 }],
  "equal-14": [lucide.Equal, { size: 14 }],
  "clock-14": [oct.ClockIcon, { size: 14 }],
  "hard-drive-14": [lucide.HardDrive, { size: 14 }],
  "file-directory": [oct.FileDirectoryIcon, { size: 16 }],
  image: [oct.ImageIcon, { size: 16 }],
  cloud: [oct.CloudIcon, { size: 16 }],
  wrench: [lucide.Wrench, { size: 16 }],
  "file-archive": [lucide.FileArchive, { size: 16 }],
  file: [oct.FileIcon, { size: 16 }],
  link: [oct.LinkIcon, { size: 16 }],
  unlink: [oct.UnlinkIcon, { size: 16 }],
  "arrow-up-16": [oct.ArrowUpIcon, { size: 16 }],
  "arrow-down-16": [oct.ArrowDownIcon, { size: 16 }],
  "trash-16": [oct.TrashIcon, { size: 16 }],
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
  "arrow-down-24": [oct.ArrowDownIcon, { size: 24 }],
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
