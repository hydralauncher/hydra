using System;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;

// Build-only dependency on the Windows .NET Framework compiler. At runtime this
// executable directly owns the same kill-on-close job used by the UAC supervisor.
public static class HydraEpicProcess {
  const int Protocol = 1;
  const int PollInterval = 100;
  const int MaximumRequestBytes = 131072;
  public sealed class Request {
    public int protocol { get; set; }
    public string executable { get; set; }
    public string[] arguments { get; set; }
    public string cancellation { get; set; }
  }
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

  static string Quote(string value) {
    string escaped = Regex.Replace(value, "(\\\\*)\"", "$1$1\\\"");
    return "\"" + Regex.Replace(escaped, "(\\\\+)$", "$1$1") + "\"";
  }
  public static int Main(string[] args) {
    if (args.Length == 1 && args[0] == "--version") {
      Console.WriteLine("hydra-epic-process protocol=" + Protocol);
      return 0;
    }
    try {
      if (args.Length != 2 || args[0] != "--request" || !Path.IsPathRooted(args[1])) return 1;
      FileInfo file = new FileInfo(args[1]);
      if (!file.Exists || file.Length > MaximumRequestBytes) return 1;
      Request request = new JavaScriptSerializer().Deserialize<Request>(File.ReadAllText(file.FullName, Encoding.UTF8));
      if (request == null || request.protocol != Protocol || request.arguments == null ||
          String.IsNullOrEmpty(request.executable) || !Path.IsPathRooted(request.executable) ||
          String.IsNullOrEmpty(request.cancellation) || !Path.IsPathRooted(request.cancellation)) return 1;
      StringBuilder command = new StringBuilder(Quote(request.executable));
      foreach (string argument in request.arguments) {
        if (argument == null || argument.IndexOf('\0') >= 0) return 1;
        command.Append(' ').Append(Quote(argument));
      }
      if (command.Length > 32766) return 1;
      return Run(request.executable, command, request.cancellation);
    } catch (Win32Exception error) {
      Console.Error.WriteLine("HYDRA_PROCESS_SPAWN_ERROR:" + error.NativeErrorCode);
      return 1;
    } catch {
      // Request paths, arguments and child output must never enter diagnostics.
      return 1;
    }
  }
  static int Run(string executable, StringBuilder command, string cancellation) {
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
      if (!CreateProcess(executable, command, IntPtr.Zero, IntPtr.Zero, true, 0x08000004, IntPtr.Zero, Path.GetDirectoryName(executable), ref startup, out process)) throw new Win32Exception();
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
        Thread.Sleep(PollInterval);
      }
      uint code;
      if (!GetExitCodeProcess(process.Process, out code)) throw new Win32Exception();
      return unchecked((int)code);
    } finally {
      // A failed assignment leaves only a suspended child; it must also close.
      if (assigned) {
        TerminateJobObject(job, 1);
        while (true) {
          Accounting accounting;
          if (QueryInformationJobObject(job, 1, out accounting, (uint)Marshal.SizeOf(typeof(Accounting)), IntPtr.Zero) && accounting.ActiveProcesses == 0) break;
          Thread.Sleep(PollInterval);
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
}
