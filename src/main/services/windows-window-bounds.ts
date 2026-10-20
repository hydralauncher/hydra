import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { logger } from "./logger";
import {
  getClientAreaCrop,
  getWindowHandleFromSourceId,
  parseScreenRect,
} from "./windows-client-area-crop";

const execFileAsync = promisify(execFile);

const WINDOW_BOUNDS_TIMEOUT_MS = 5_000;

const buildWindowBoundsScript = (windowHandle: string) =>
  [
    'Add-Type -TypeDefinition \'using System; using System.Runtime.InteropServices; public static class HydraWindowBounds { [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; } [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; } [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context); [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr hWnd, int attribute, out RECT value, int size); [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr hWnd, out RECT rect); [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr hWnd, ref POINT point); }\'',
    "try { [void][HydraWindowBounds]::SetThreadDpiAwarenessContext([IntPtr](-4)) } catch {}",
    `$handle = [IntPtr]::new([Int64]${windowHandle})`,
    "$frame = New-Object HydraWindowBounds+RECT",
    "$frameBounds = ''",
    'if ([HydraWindowBounds]::DwmGetWindowAttribute($handle, 9, [ref]$frame, 16) -eq 0) { $frameBounds = "$($frame.Left) $($frame.Top) $($frame.Right) $($frame.Bottom)" }',
    "$client = New-Object HydraWindowBounds+RECT",
    "$origin = New-Object HydraWindowBounds+POINT",
    "$clientBounds = ''",
    'if ([HydraWindowBounds]::GetClientRect($handle, [ref]$client) -and [HydraWindowBounds]::ClientToScreen($handle, [ref]$origin)) { $clientBounds = "$($origin.X) $($origin.Y) $($origin.X + $client.Right) $($origin.Y + $client.Bottom)" }',
    "Write-Output $frameBounds",
    "Write-Output $clientBounds",
  ].join("; ");

export const cropToWindowClientArea = async (
  image: Electron.NativeImage,
  sourceId: string
) => {
  const windowHandle = getWindowHandleFromSourceId(sourceId);
  if (!windowHandle) return image;

  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        buildWindowBoundsScript(windowHandle),
      ],
      { windowsHide: true, timeout: WINDOW_BOUNDS_TIMEOUT_MS }
    );
    const [frameBounds, clientBounds] = stdout.split(/\r?\n/);
    const clientArea = getClientAreaCrop(
      parseScreenRect(frameBounds),
      parseScreenRect(clientBounds),
      image.getSize()
    );

    logger.info("Windows window client area resolved", {
      sourceId,
      frameBounds,
      clientBounds,
      clientArea,
    });

    return clientArea ? image.crop(clientArea) : image;
  } catch (error) {
    logger.warn("Failed to resolve the Windows window client area", {
      sourceId,
      error,
    });
    return image;
  }
};
