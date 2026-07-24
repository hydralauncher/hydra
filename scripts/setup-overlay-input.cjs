const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

if (process.platform !== "win32") process.exit(0);

const systemRoot = process.env.SystemRoot ?? String.raw`C:\Windows`;
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
const brokerPresentMon = path.join(path.dirname(broker), "PresentMon.exe");
if (!fs.existsSync(brokerPresentMon)) {
  fs.copyFileSync(presentMon, brokerPresentMon);
}
const escapedBroker = broker.replaceAll("'", "''");
const escapedPowershell = powershell.replaceAll("'", "''");
const command = [
  `$action = New-ScheduledTaskAction -Execute '${escapedBroker}'`,
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
