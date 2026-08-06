const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

if (process.platform !== "win32") process.exit(0);

const systemRoot = process.env.SystemRoot ?? String.raw`C:\Windows`;
const stableDirectory = path.join(
  path.parse(systemRoot).root,
  "Program Files",
  "Hydra Overlay Input"
);
const dataDirectory = path.join(
  process.env.APPDATA ??
    path.join(path.parse(systemRoot).root, "Users", process.env.USERNAME ?? ""),
  "hydralauncher",
  "overlay-input"
);
const powershell = path.join(
  systemRoot,
  "System32",
  "WindowsPowerShell",
  "v1.0",
  "powershell.exe"
);
const broker = path.resolve(
  __dirname,
  "..",
  "hydra-native",
  "hydra-overlay-input.exe"
);
const presentMon = path.resolve(
  __dirname,
  "..",
  "presentmon",
  "PresentMon.exe"
);
if (!fs.existsSync(broker) || !fs.existsSync(presentMon)) process.exit(1);
const escapePowershellLiteral = (value) => value.replaceAll("'", "''");
const stableBroker = path.join(stableDirectory, "hydra-overlay-input.exe");
const clientExecutable = require("electron");
const escapedPowershell = powershell.replaceAll("'", "''");
const command = [
  "Stop-ScheduledTask -TaskName 'Hydra Overlay Input' -ErrorAction SilentlyContinue",
  `$directory = '${escapePowershellLiteral(stableDirectory)}'`,
  "New-Item -ItemType Directory -Path $directory -Force | Out-Null",
  `Copy-Item -LiteralPath '${escapePowershellLiteral(broker)}' -Destination '${escapePowershellLiteral(stableBroker)}' -Force`,
  `Copy-Item -LiteralPath '${escapePowershellLiteral(presentMon)}' -Destination '${escapePowershellLiteral(path.join(stableDirectory, "PresentMon.exe"))}' -Force`,
  `$arguments = '--data-directory "${escapePowershellLiteral(dataDirectory)}" --client-executable "${escapePowershellLiteral(clientExecutable)}"'`,
  `$action = New-ScheduledTaskAction -Execute '${escapePowershellLiteral(stableBroker)}' -Argument $arguments`,
  "$trigger = New-ScheduledTaskTrigger -Once -At ([datetime]'2099-01-01T00:00:00')",
  "$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Highest",
  "Register-ScheduledTask -TaskName 'Hydra Overlay Input' -Action $action -Trigger $trigger -Principal $principal -Force | Out-Null",
].join("; ");
const encoded = Buffer.from(command, "utf16le").toString("base64");
const result = childProcess.spawnSync(
  powershell,
  [
    "-NoProfile",
    "-Command",
    `Start-Process '${escapedPowershell}' -Verb RunAs -Wait -ArgumentList '-NoProfile','-EncodedCommand','${encoded}'`,
  ],
  { stdio: "inherit" }
);
process.exit(result.status ?? 1);
