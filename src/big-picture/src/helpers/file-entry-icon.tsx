import type { ReactNode } from "react";
import {
  AppleLogoIcon,
  DiscIcon,
  FileArchiveIcon,
  HeadphonesIcon,
  FileCIcon,
  FileCodeIcon,
  FileCppIcon,
  FileCSharpIcon,
  FileCssIcon,
  FileCsvIcon,
  FileDocIcon,
  FileHtmlIcon,
  FileIcon,
  ImageIcon,
  FileIniIcon,
  FileJsIcon,
  FileJsxIcon,
  FileLockIcon,
  FileMdIcon,
  FilePyIcon,
  FileSqlIcon,
  FileSvgIcon,
  FileTsIcon,
  FileTsxIcon,
  FileTxtIcon,
  VideoCameraIcon,
  FloppyDiskIcon,
  FolderIcon,
  LinuxLogoIcon,
  TerminalWindowIcon,
  WindowsLogoIcon,
  FilePdfIcon,
} from "@phosphor-icons/react";

export interface DirectoryEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  isFile: boolean;
  extension: string;
  size: number;
  fileCount: number;
}

const iconProps = {
  size: 22,
  weight: "fill",
} as const;

export const imageExtensions = new Set([
  "jpg",
  "jpeg",
  "jpe",
  "jfif",
  "pjpeg",
  "pjp",
  "png",
  "apng",
  "gif",
  "webp",
  "bmp",
  "dib",
  "ico",
  "cur",
  "tif",
  "tiff",
  "avif",
  "heic",
  "heif",
  "jxl",
  "psd",
  "xcf",
  "raw",
  "dng",
  "cr2",
  "cr3",
  "nef",
  "arw",
  "orf",
  "rw2",
  "raf",
  "pef",
  "srw",
]);

export const audioExtensions = new Set([
  "mp3",
  "mp2",
  "mpa",
  "wav",
  "wave",
  "ogg",
  "oga",
  "opus",
  "flac",
  "m4a",
  "aac",
  "adts",
  "wma",
  "aiff",
  "aif",
  "aifc",
  "ape",
  "alac",
  "amr",
  "mka",
  "weba",
  "mid",
  "midi",
  "kar",
  "mod",
  "xm",
  "it",
  "s3m",
  "umx",
  "ac3",
  "dts",
  "mka",
  "tta",
  "wv",
  "ra",
]);

export const videoExtensions = new Set([
  "mp4",
  "m4v",
  "avi",
  "mkv",
  "mov",
  "qt",
  "wmv",
  "webm",
  "mpeg",
  "mpg",
  "mpe",
  "mpv",
  "m2v",
  "flv",
  "f4v",
  "3gp",
  "3g2",
  "ogv",
  "m2ts",
  "mts",
  "vob",
  "asf",
  "rm",
  "rmvb",
  "divx",
]);

export const archiveExtensions = new Set([
  "zip",
  "rar",
  "7z",
  "tar",
  "gz",
  "tgz",
  "xz",
  "txz",
  "bz",
  "bz2",
  "tbz",
  "tbz2",
  "z",
  "zst",
  "tzst",
  "lz",
  "lzma",
  "lz4",
  "cab",
  "ar",
  "cpio",
  "apk",
  "xapk",
  "apks",
  "aab",
  "jar",
  "war",
  "ear",
  "whl",
  "egg",
  "nupkg",
  "vsix",
  "gem",
]);

export const discExtensions = new Set([
  "iso",
  "bin",
  "cue",
  "img",
  "ccd",
  "sub",
  "mdf",
  "mds",
  "nrg",
  "cdi",
  "gdi",
  "chd",
  "ecm",
  "pbp",
  "cso",

  "nes",
  "fds",
  "unf",
  "unif",

  "sfc",
  "smc",
  "fig",
  "swc",

  "gb",
  "gbc",
  "gba",

  "n64",
  "z64",
  "v64",

  "nds",
  "dsi",
  "3ds",
  "cia",
  "cxi",
  "cci",

  "gcm",
  "rvz",
  "wbfs",
  "wad",
  "wia",
  "wua",
  "wud",
  "wux",
  "gcz",
  "dol",

  "nsp",
  "xci",
  "nro",
  "nso",
  "nca",
  "ncz",
  "xcz",

  "sms",
  "gg",
  "sg",
  "smd",
  "gen",
  "32x",
  "68k",

  "pce",
  "sgx",

  "a26",
  "a52",
  "a78",
  "j64",
  "lnx",

  "st",
  "msa",
  "stx",

  "ws",
  "wsc",

  "ngp",
  "ngc",

  "col",
  "int",
  "vec",

  "tap",
  "tzx",
  "dsk",
  "adf",
  "ipf",

  "elf",
  "prx",
  "pkg",
  "vpk",
  "3dsx",
]);

export const scriptExtensions = new Set([
  "sh",
  "bash",
  "zsh",
  "fish",
  "ksh",
  "csh",
  "tcsh",
  "cmd",
  "bat",
  "ps1",
  "psm1",
  "psd1",
  "vbs",
  "vbe",
  "wsf",
  "wsh",
  "command",
  "run",
]);

export const saveExtensions = new Set([
  "mcr",
  "mcd",
  "mc",
  "mci",
  "psu",
  "ps2",
  "max",
  "cbs",
  "xps",
  "sps",
  "psv",

  "vmem",
  "srm",
  "sav",
  "save",
  "state",
  "sgm",
  "dsv",
  "dst",
  "gci",
  "vmu",
  "dci",
  "duc",

  "eep",
  "eeprom",
  "fla",
  "flash",
  "nv",
  "nvm",
  "sa1",
  "fra",
  "fs",
]);

export const patchExtensions = new Set([
  "ips",
  "bps",
  "ups",
  "xdelta",
  "xdelta3",
  "vcdiff",
  "ppf",
  "aps",
]);

export const codeExtensions = new Set([
  "go",
  "rs",
  "rb",
  "php",
  "java",
  "swift",
  "kt",
  "kts",
  "scala",
  "pl",
  "pm",
  "lua",
  "r",
  "dart",
  "groovy",
  "clj",
  "cljs",
  "elm",
  "ex",
  "exs",
  "erl",
  "hrl",
  "hs",
  "ml",
  "mli",
  "nim",
  "cr",
  "zig",
  "odin",
  "v",
  "wgsl",
  "vue",
  "svelte",
  "astro",
  "gradle",
  "toml",
  "yaml",
  "yml",
  "json",
  "jsonc",
  "json5",
  "xml",
  "xaml",
  "proto",
  "graphql",
  "gql",
  "sol",
  "tf",
  "tfvars",
  "hcl",
  "ipynb",
]);

const extensionIcons: Record<string, ReactNode> = {
  c: <FileCIcon {...iconProps} />,
  h: <FileCIcon {...iconProps} />,

  cs: <FileCSharpIcon {...iconProps} />,

  cpp: <FileCppIcon {...iconProps} />,
  cxx: <FileCppIcon {...iconProps} />,
  cc: <FileCppIcon {...iconProps} />,
  "c++": <FileCppIcon {...iconProps} />,
  hpp: <FileCppIcon {...iconProps} />,
  hxx: <FileCppIcon {...iconProps} />,
  hh: <FileCppIcon {...iconProps} />,

  css: <FileCssIcon {...iconProps} />,
  scss: <FileCssIcon {...iconProps} />,
  less: <FileCssIcon {...iconProps} />,
  sass: <FileCssIcon {...iconProps} />,

  csv: <FileCsvIcon {...iconProps} />,
  tsv: <FileCsvIcon {...iconProps} />,
  xls: <FileCsvIcon {...iconProps} />,
  xlsx: <FileCsvIcon {...iconProps} />,
  xlsm: <FileCsvIcon {...iconProps} />,
  ods: <FileCsvIcon {...iconProps} />,

  doc: <FileDocIcon {...iconProps} />,
  docx: <FileDocIcon {...iconProps} />,
  gdoc: <FileDocIcon {...iconProps} />,
  odt: <FileDocIcon {...iconProps} />,
  rtf: <FileDocIcon {...iconProps} />,
  tex: <FileDocIcon {...iconProps} />,
  ppt: <FileDocIcon {...iconProps} />,
  pptx: <FileDocIcon {...iconProps} />,
  odp: <FileDocIcon {...iconProps} />,
  epub: <FileDocIcon {...iconProps} />,
  mobi: <FileDocIcon {...iconProps} />,
  azw: <FileDocIcon {...iconProps} />,
  azw3: <FileDocIcon {...iconProps} />,

  html: <FileHtmlIcon {...iconProps} />,
  htm: <FileHtmlIcon {...iconProps} />,
  xhtml: <FileHtmlIcon {...iconProps} />,

  ini: <FileIniIcon {...iconProps} />,
  cfg: <FileIniIcon {...iconProps} />,
  conf: <FileIniIcon {...iconProps} />,
  config: <FileIniIcon {...iconProps} />,
  properties: <FileIniIcon {...iconProps} />,

  js: <FileJsIcon {...iconProps} />,
  mjs: <FileJsIcon {...iconProps} />,
  cjs: <FileJsIcon {...iconProps} />,

  jsx: <FileJsxIcon {...iconProps} />,

  lock: <FileLockIcon {...iconProps} />,
  env: <FileLockIcon {...iconProps} />,
  pem: <FileLockIcon {...iconProps} />,
  key: <FileLockIcon {...iconProps} />,
  crt: <FileLockIcon {...iconProps} />,
  cer: <FileLockIcon {...iconProps} />,
  pfx: <FileLockIcon {...iconProps} />,
  p12: <FileLockIcon {...iconProps} />,
  asc: <FileLockIcon {...iconProps} />,
  sig: <FileLockIcon {...iconProps} />,

  md: <FileMdIcon {...iconProps} />,
  markdown: <FileMdIcon {...iconProps} />,
  mdx: <FileMdIcon {...iconProps} />,
  rst: <FileMdIcon {...iconProps} />,

  py: <FilePyIcon {...iconProps} />,
  pyw: <FilePyIcon {...iconProps} />,

  sql: <FileSqlIcon {...iconProps} />,
  sqlite: <FileSqlIcon {...iconProps} />,
  sqlite3: <FileSqlIcon {...iconProps} />,
  db: <FileSqlIcon {...iconProps} />,

  svg: <FileSvgIcon {...iconProps} />,

  ts: <FileTsIcon {...iconProps} />,
  tsx: <FileTsxIcon {...iconProps} />,

  txt: <FileTxtIcon {...iconProps} />,
  text: <FileTxtIcon {...iconProps} />,
  log: <FileTxtIcon {...iconProps} />,
  nfo: <FileTxtIcon {...iconProps} />,

  exe: <WindowsLogoIcon {...iconProps} />,
  msi: <WindowsLogoIcon {...iconProps} />,
  msp: <WindowsLogoIcon {...iconProps} />,
  msu: <WindowsLogoIcon {...iconProps} />,
  appx: <WindowsLogoIcon {...iconProps} />,
  appxbundle: <WindowsLogoIcon {...iconProps} />,
  msix: <WindowsLogoIcon {...iconProps} />,
  msixbundle: <WindowsLogoIcon {...iconProps} />,
  appinstaller: <WindowsLogoIcon {...iconProps} />,
  com: <WindowsLogoIcon {...iconProps} />,
  scr: <WindowsLogoIcon {...iconProps} />,
  dll: <WindowsLogoIcon {...iconProps} />,
  sys: <WindowsLogoIcon {...iconProps} />,

  appimage: <LinuxLogoIcon {...iconProps} />,
  deb: <LinuxLogoIcon {...iconProps} />,
  udeb: <LinuxLogoIcon {...iconProps} />,
  rpm: <LinuxLogoIcon {...iconProps} />,
  flatpak: <LinuxLogoIcon {...iconProps} />,
  flatpakref: <LinuxLogoIcon {...iconProps} />,
  flatpakrepo: <LinuxLogoIcon {...iconProps} />,
  snap: <LinuxLogoIcon {...iconProps} />,
  desktop: <LinuxLogoIcon {...iconProps} />,

  dmg: <AppleLogoIcon {...iconProps} />,
  app: <AppleLogoIcon {...iconProps} />,
  ipa: <AppleLogoIcon {...iconProps} />,
  xip: <AppleLogoIcon {...iconProps} />,
  mpkg: <AppleLogoIcon {...iconProps} />,

  pdf: <FilePdfIcon {...iconProps} />,
};

const groupedExtensionIcons: Array<[Set<string>, ReactNode]> = [
  [imageExtensions, <ImageIcon {...iconProps} key="image" />],
  [audioExtensions, <HeadphonesIcon {...iconProps} key="audio" />],
  [videoExtensions, <VideoCameraIcon {...iconProps} key="video" />],
  [archiveExtensions, <FileArchiveIcon {...iconProps} key="archive" />],
  [discExtensions, <DiscIcon {...iconProps} key="disc" />],
  [scriptExtensions, <TerminalWindowIcon {...iconProps} key="script" />],
  [saveExtensions, <FloppyDiskIcon {...iconProps} key="save" />],
  [patchExtensions, <FileCodeIcon {...iconProps} key="patch" />],
  [codeExtensions, <FileCodeIcon {...iconProps} key="code" />],
];

function normalizeExtension(extension: string): string {
  return extension.replace(/^\./, "").toLowerCase();
}

function getIconByExtension(extension: string): ReactNode {
  const directIcon = extensionIcons[extension];

  if (directIcon) return directIcon;

  const groupedIcon = groupedExtensionIcons.find(([extensions]) =>
    extensions.has(extension)
  );

  return groupedIcon?.[1] ?? <FileIcon {...iconProps} />;
}

export function getEntryIcon(entry: DirectoryEntry): ReactNode {
  const extension = normalizeExtension(entry.extension);

  if (entry.isDirectory) {
    if (entry.name.toLowerCase().endsWith(".app")) {
      return <AppleLogoIcon {...iconProps} />;
    }

    return <FolderIcon {...iconProps} />;
  }

  return getIconByExtension(extension);
}
