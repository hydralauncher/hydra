import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EPIC_PREREQUISITE_TIMEOUT_MS } from "./constants.js";
import {
  EpicManagedError,
  executeManagedLegendary,
} from "./legendary-managed-runtime.js";

import {
  epicPrerequisiteSupervisorScript,
  quoteWindowsEpicArgument,
} from "./windows-process-job.js";
export {
  epicPrerequisiteSupervisorScript,
  quoteWindowsEpicArgument,
} from "./windows-process-job.js";

const WINDOWS_SUCCESS_EXIT_CODES = [0, 3010, 1641];
const encodeScript = (script: string) =>
  Buffer.from(script, "utf16le").toString("base64");

export async function runElevatedEpicPrerequisite(
  executable: string,
  args: string[],
  signal: AbortSignal,
  execute = executeManagedLegendary
) {
  if (signal.aborted) throw new EpicManagedError("operation-cancelled");
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "hydra-epic-prerequisite-")
  );
  await fs.chmod(directory, 0o700);
  const cancellation = path.join(directory, "cancel");
  const powershell = path.win32.join(
    process.env.SystemRoot || String.raw`C:\Windows`,
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe"
  );
  const script = epicPrerequisiteSupervisorScript(
    executable,
    args,
    cancellation
  );
  const supervisorPath = path.join(directory, "supervisor.ps1");
  await fs.writeFile(supervisorPath, script, { mode: 0o600, flag: "wx" });
  const launcher = `$ErrorActionPreference = 'Stop'
try {
  $epicSupervisor = Start-Process -FilePath '${powershell.replaceAll("'", "''")}' -ArgumentList '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File ${quoteWindowsEpicArgument(supervisorPath).replaceAll("'", "''")}' -Verb RunAs -PassThru -Wait -WindowStyle Hidden
  if ($null -eq $epicSupervisor.ExitCode) { exit 1 }
  exit $epicSupervisor.ExitCode
} catch { exit 1 }
`;
  let cancellationReason: EpicManagedError | undefined;
  let cancelWrite: Promise<void> | undefined;
  const cancel = (reason: EpicManagedError) => {
    cancellationReason ??= reason;
    cancelWrite ??= fs.writeFile(cancellation, "cancel", { mode: 0o600 });
    void cancelWrite.catch(() => undefined);
  };
  const abort = () => cancel(new EpicManagedError("operation-cancelled"));
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  const timeout = setTimeout(
    () => cancel(new EpicManagedError("timeout")),
    EPIC_PREREQUISITE_TIMEOUT_MS
  );
  try {
    try {
      // Killing this unelevated launcher would abandon the UAC-brokered process.
      // Its close is awaited after the supervisor has stopped the entire job.
      await execute(
        powershell,
        [
          "-NoProfile",
          "-NonInteractive",
          "-EncodedCommand",
          encodeScript(launcher),
        ],
        path.dirname(executable),
        {
          signal: new AbortController().signal,
          successExitCodes: WINDOWS_SUCCESS_EXIT_CODES,
        }
      );
    } catch (error) {
      if (!cancellationReason) throw error;
    }
    await cancelWrite;
    if (cancellationReason) throw cancellationReason;
    return true;
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
    await cancelWrite?.catch(() => undefined);
    await fs.rm(directory, { recursive: true, force: true });
  }
}
