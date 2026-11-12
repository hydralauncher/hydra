import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export const quoteWindowsEpicArgument = (value: string) =>
  `"${value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, "$1$1")}"`;

const PREREQUISITE_POLL_INTERVAL_MS = 100;
const MANAGED_PROCESS_PROTOCOL = 1;
const MANAGED_PROCESS_BINARY = "hydra-epic-process.exe";
const MANAGED_PROCESS_RECEIPT = "hydra-epic-process.json";
const verifiedSupervisors = new Map<string, Promise<string>>();

const verifyManagedEpicProcessSupervisor = async (directory: string) => {
  const binary = path.join(directory, MANAGED_PROCESS_BINARY);
  const receipt = JSON.parse(
    await fs.readFile(path.join(directory, MANAGED_PROCESS_RECEIPT), "utf8")
  );
  if (
    receipt.protocol !== MANAGED_PROCESS_PROTOCOL ||
    receipt.fileName !== MANAGED_PROCESS_BINARY ||
    typeof receipt.sourceSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(receipt.sourceSha256) ||
    typeof receipt.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(receipt.sha256) ||
    createHash("sha256")
      .update(await fs.readFile(binary))
      .digest("hex") !== receipt.sha256
  )
    throw new Error("Invalid Epic process supervisor");
  return binary;
};

/** The caller owns the private cancellation directory and removes it on close. */
export async function getManagedEpicProcessCommand(
  helperDirectory: string,
  executable: string,
  args: string[],
  cancellation: string
): Promise<{ binary: string; args: string[] }> {
  let verified = verifiedSupervisors.get(helperDirectory);
  if (!verified) {
    verified = verifyManagedEpicProcessSupervisor(helperDirectory).catch(
      (error) => {
        verifiedSupervisors.delete(helperDirectory);
        throw error;
      }
    );
    verifiedSupervisors.set(helperDirectory, verified);
  }
  const binary = await verified;
  const request = path.join(path.dirname(cancellation), "request.json");
  await fs.writeFile(
    request,
    JSON.stringify({
      protocol: MANAGED_PROCESS_PROTOCOL,
      executable,
      arguments: args,
      cancellation,
    }),
    { mode: 0o600, flag: "wx" }
  );
  return { binary, args: ["--request", request] };
}

// A UAC child is brokered outside the launcher's tree. The elevated supervisor
// owns a job, including every descendant, and is the only process that cancels it.
// CreateProcess is suspended so the executable cannot spawn before assignment.
const EPIC_PREREQUISITE_JOB_SOURCE = String.raw`
using System;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
public static class HydraEpicPrerequisiteJob {
  [StructLayout(LayoutKind.Sequential)] struct Limits {
    public long ProcessTime, JobTime;
    public uint Flags;
    public UIntPtr MinWorkingSet, MaxWorkingSet;
    public uint ActiveProcessLimit;
    public UIntPtr Affinity;
    public uint PriorityClass, SchedulingClass;
  }
  [StructLayout(LayoutKind.Sequential)] struct IoCounters {
    public ulong ReadOperations, WriteOperations, OtherOperations, ReadBytes, WriteBytes, OtherBytes;
  }
  [StructLayout(LayoutKind.Sequential)] struct ExtendedLimits {
    public Limits Basic;
    public IoCounters Io;
    public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
  }
  [StructLayout(LayoutKind.Sequential)] struct Accounting {
    public long UserTime, KernelTime, PeriodUserTime, PeriodKernelTime;
    public uint PageFaults, TotalProcesses, ActiveProcesses, TerminatedProcesses;
  }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct Startup {
    public uint Size;
    public string Reserved, Desktop, Title;
    public uint X, Y, XSize, YSize, XChars, YChars, FillAttribute, Flags;
    public ushort ShowWindow, ReservedSize;
    public IntPtr ReservedData, Input, Output, Error;
  }
  [StructLayout(LayoutKind.Sequential)] struct ProcessInfo {
    public IntPtr Process, Thread;
    public uint ProcessId, ThreadId;
  }
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr attributes, string name);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job, int type, ref ExtendedLimits limits, uint length);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job, int type, out Accounting accounting, uint length, IntPtr returned);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateJobObject(IntPtr job, uint code);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateProcess(IntPtr process, uint code);
  [DllImport("kernel32.dll", SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr process, out uint code);
  [DllImport("kernel32.dll", SetLastError=true)] static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int kind);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool CreateProcess(string application, StringBuilder command, IntPtr processAttributes, IntPtr threadAttributes, bool inherit, uint flags, IntPtr environment, string directory, ref Startup startup, out ProcessInfo info);
  public static int Run(string executable, string command, string cancellation, int pollInterval) {
    if (File.Exists(cancellation)) return 1;
    IntPtr job = CreateJobObject(IntPtr.Zero, null);
    if (job == IntPtr.Zero) throw new Win32Exception();
    ProcessInfo process = new ProcessInfo();
    bool assigned = false;
    try {
      ExtendedLimits limits = new ExtendedLimits();
      limits.Basic.Flags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE; no breakaway.
      if (!SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf(limits))) throw new Win32Exception();
      Startup startup = new Startup();
      startup.Size = (uint)Marshal.SizeOf(startup);
      startup.Flags = 0x100; // STARTF_USESTDHANDLES: preserve JSON and streaming output.
      startup.Input = GetStdHandle(-10);
      startup.Output = GetStdHandle(-11);
      startup.Error = GetStdHandle(-12);
      if (!CreateProcess(executable, new StringBuilder(command), IntPtr.Zero, IntPtr.Zero, true, 0x08000004, IntPtr.Zero, Path.GetDirectoryName(executable), ref startup, out process)) throw new Win32Exception();
      if (!AssignProcessToJobObject(job, process.Process)) throw new Win32Exception();
      assigned = true;
      if (ResumeThread(process.Thread) == UInt32.MaxValue) throw new Win32Exception();
      bool cancelled = false;
      while (true) {
        Accounting accounting;
        if (!QueryInformationJobObject(job, 1, out accounting, (uint)Marshal.SizeOf(typeof(Accounting)), IntPtr.Zero)) throw new Win32Exception();
        if (accounting.ActiveProcesses == 0) break;
        if (!cancelled && File.Exists(cancellation)) {
          if (!TerminateJobObject(job, 1)) throw new Win32Exception();
          cancelled = true;
        }
        Thread.Sleep(pollInterval);
      }
      uint code;
      if (!GetExitCodeProcess(process.Process, out code)) throw new Win32Exception();
      return unchecked((int)code);
    } finally {
      // Failures before job assignment leave only a suspended process.
      if (assigned) {
        TerminateJobObject(job, 1);
        while (true) {
          Accounting accounting;
          if (QueryInformationJobObject(job, 1, out accounting, (uint)Marshal.SizeOf(typeof(Accounting)), IntPtr.Zero) && accounting.ActiveProcesses == 0) break;
          Thread.Sleep(pollInterval);
        }
      } else if (process.Process != IntPtr.Zero) {
        TerminateProcess(process.Process, 1);
        WaitForSingleObject(process.Process, UInt32.MaxValue);
      }
      CloseHandle(job);
      if (process.Thread != IntPtr.Zero) CloseHandle(process.Thread);
      if (process.Process != IntPtr.Zero) CloseHandle(process.Process);
    }
  }
}`;

export function epicPrerequisiteSupervisorScript(
  executable: string,
  args: string[],
  cancellation: string
) {
  const payload = Buffer.from(
    JSON.stringify({
      executable,
      command: [executable, ...args].map(quoteWindowsEpicArgument).join(" "),
      cancellation,
      pollInterval: PREREQUISITE_POLL_INTERVAL_MS,
    })
  ).toString("base64");
  return `$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try {
  Add-Type -TypeDefinition @'
${EPIC_PREREQUISITE_JOB_SOURCE}
'@
  $epicPrerequisite = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}')) | ConvertFrom-Json
  exit [HydraEpicPrerequisiteJob]::Run($epicPrerequisite.executable, $epicPrerequisite.command, $epicPrerequisite.cancellation, $epicPrerequisite.pollInterval)
} catch {
  $epicFailure = $_.Exception
  while ($null -ne $epicFailure.InnerException) { $epicFailure = $epicFailure.InnerException }
  if ($epicFailure -is [System.ComponentModel.Win32Exception]) { [Console]::Error.WriteLine('HYDRA_PROCESS_SPAWN_ERROR:' + $epicFailure.NativeErrorCode) }
  exit 1
}
`;
}
