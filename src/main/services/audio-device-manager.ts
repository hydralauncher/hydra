import { execFile } from "node:child_process";
import { Buffer } from "node:buffer";
import type { HydraAudioDevice } from "@types";
import { logger } from "./logger";

const coreAudioScript = String.raw`
Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public enum EDataFlow { eRender = 0, eCapture = 1, eAll = 2 }
public enum ERole { eConsole = 0, eMultimedia = 1, eCommunications = 2 }
public enum DeviceState { Active = 1 }

[StructLayout(LayoutKind.Sequential)]
public struct PROPERTYKEY {
  public Guid fmtid;
  public uint pid;
}

[StructLayout(LayoutKind.Sequential)]
public struct PROPVARIANT {
  public ushort vt;
  public ushort wReserved1;
  public ushort wReserved2;
  public ushort wReserved3;
  public IntPtr p;
  public int p2;
}

[ComImport]
[Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
public class MMDeviceEnumerator {}

[ComImport]
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDeviceEnumerator {
  [PreserveSig]
  int EnumAudioEndpoints(EDataFlow dataFlow, DeviceState stateMask, [MarshalAs(UnmanagedType.Interface)] out IMMDeviceCollection devices);
  [PreserveSig]
  int GetDefaultAudioEndpoint(EDataFlow dataFlow, ERole role, [MarshalAs(UnmanagedType.Interface)] out IMMDevice endpoint);
}

[ComImport]
[Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDeviceCollection {
  [PreserveSig]
  int GetCount(out uint count);
  [PreserveSig]
  int Item(uint index, [MarshalAs(UnmanagedType.Interface)] out IMMDevice device);
}

[ComImport]
[Guid("D666063F-1587-4E43-81F1-B948E807363F")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDevice {
  [PreserveSig]
  int Activate(ref Guid iid, uint clsCtx, IntPtr activationParams, out IntPtr interfacePointer);
  [PreserveSig]
  int OpenPropertyStore(uint access, [MarshalAs(UnmanagedType.Interface)] out IPropertyStore propertyStore);
  [PreserveSig]
  int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
  [PreserveSig]
  int GetState(out uint state);
}

[ComImport]
[Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IPropertyStore {
  [PreserveSig]
  int GetCount(out uint propertyCount);
  [PreserveSig]
  int GetAt(uint propertyIndex, out PROPERTYKEY key);
  [PreserveSig]
  int GetValue(ref PROPERTYKEY key, out PROPVARIANT value);
  [PreserveSig]
  int SetValue(ref PROPERTYKEY key, ref PROPVARIANT value);
  [PreserveSig]
  int Commit();
}

[ComImport]
[Guid("870af99c-171d-4f9e-af0d-e63df40c2bc9")]
public class PolicyConfigClient {}

[ComImport]
[Guid("f8679f50-850a-41cf-9c72-430f290290c8")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IPolicyConfig {
  void GetMixFormat([MarshalAs(UnmanagedType.LPWStr)] string deviceName, out IntPtr waveFormat);
  void GetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string deviceName, int defaultFormat, out IntPtr waveFormat);
  void ResetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string deviceName);
  void SetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string deviceName, IntPtr waveFormat, IntPtr mixFormat);
  void GetProcessingPeriod([MarshalAs(UnmanagedType.LPWStr)] string deviceName, int defaultPeriod, out long defaultDevicePeriod, out long minimumDevicePeriod);
  void SetProcessingPeriod([MarshalAs(UnmanagedType.LPWStr)] string deviceName, IntPtr period);
  void GetShareMode([MarshalAs(UnmanagedType.LPWStr)] string deviceName, IntPtr mode);
  void SetShareMode([MarshalAs(UnmanagedType.LPWStr)] string deviceName, IntPtr mode);
  void GetPropertyValue([MarshalAs(UnmanagedType.LPWStr)] string deviceName, ref PROPERTYKEY key, out PROPVARIANT value);
  void SetPropertyValue([MarshalAs(UnmanagedType.LPWStr)] string deviceName, ref PROPERTYKEY key, ref PROPVARIANT value);
  void SetDefaultEndpoint([MarshalAs(UnmanagedType.LPWStr)] string deviceName, ERole role);
  void SetEndpointVisibility([MarshalAs(UnmanagedType.LPWStr)] string deviceName, int visible);
}

public class AudioDeviceDto {
  public string id { get; set; }
  public string label { get; set; }
  public bool isDefault { get; set; }
}

public static class HydraAudio {
  private static PROPERTYKEY FriendlyNameKey = new PROPERTYKEY {
    fmtid = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0"),
    pid = 14
  };

  public static List<AudioDeviceDto> ListRenderDevices() {
    var enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumerator());
    IMMDeviceCollection collection;
    IMMDevice defaultDevice;
    string defaultId;
    uint count;
    enumerator.EnumAudioEndpoints(EDataFlow.eRender, DeviceState.Active, out collection);
    enumerator.GetDefaultAudioEndpoint(EDataFlow.eRender, ERole.eMultimedia, out defaultDevice);
    defaultDevice.GetId(out defaultId);
    collection.GetCount(out count);

    var devices = new List<AudioDeviceDto>();
    for (uint index = 0; index < count; index++) {
      IMMDevice device;
      string id;
      IPropertyStore store;
      PROPVARIANT value;
      collection.Item(index, out device);
      device.GetId(out id);
      device.OpenPropertyStore(0, out store);
      store.GetValue(ref FriendlyNameKey, out value);
      var label = Marshal.PtrToStringUni(value.p);

      devices.Add(new AudioDeviceDto {
        id = id,
        label = String.IsNullOrWhiteSpace(label) ? id : label,
        isDefault = String.Equals(id, defaultId, StringComparison.OrdinalIgnoreCase)
      });
    }

    return devices;
  }

  public static string GetDefaultRenderDeviceId() {
    var enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumerator());
    IMMDevice device;
    string id;
    enumerator.GetDefaultAudioEndpoint(EDataFlow.eRender, ERole.eMultimedia, out device);
    device.GetId(out id);
    return id;
  }

  public static void SetDefaultRenderDevice(string id) {
    var policy = (IPolicyConfig)(new PolicyConfigClient());
    policy.SetDefaultEndpoint(id, ERole.eConsole);
    policy.SetDefaultEndpoint(id, ERole.eMultimedia);
  }
}
"@
`;

const runAudioScript = async <T>(command: string): Promise<T | null> => {
  if (process.platform !== "win32") {
    return null;
  }

  const encoded = Buffer.from(
    `${coreAudioScript}\n${command}`,
    "utf16le"
  ).toString("base64");

  return await new Promise<T | null>((resolve) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
      { windowsHide: true, timeout: 10_000 },
      (error, stdout, stderr) => {
        if (error) {
          logger.warn("CoreAudio PowerShell command failed", {
            error,
            stderr,
          });
          resolve(null);
          return;
        }

        try {
          resolve(JSON.parse(stdout.trim()) as T);
        } catch {
          resolve((stdout.trim() as T) || null);
        }
      }
    );
  });
};

export class AudioDeviceManager {
  public static async getAudioDevices(): Promise<HydraAudioDevice[]> {
    return (
      (await runAudioScript<HydraAudioDevice[]>(
        "[HydraAudio]::ListRenderDevices() | ConvertTo-Json -Compress"
      )) ?? []
    );
  }

  public static async getDefaultAudioDeviceId(): Promise<string | null> {
    return await runAudioScript<string>(
      "[HydraAudio]::GetDefaultRenderDeviceId() | ConvertTo-Json -Compress"
    );
  }

  public static async setDefaultAudioDevice(id: string | null | undefined) {
    if (!id) return false;

    const escaped = id.replaceAll("'", "''");
    await runAudioScript<unknown>(
      `[HydraAudio]::SetDefaultRenderDevice('${escaped}'); "true" | ConvertTo-Json -Compress`
    );
    return true;
  }
}
