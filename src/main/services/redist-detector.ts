import fs from "fs";
import path from "path";
import { logger } from "./logger";

export interface DetectedRedist {
  dllName: string;
  componentName: string;
  packageName: string;
  silentArgs: string[];
  estimatedSizeMB: number;
  localPath: string | null;
}

interface RedistDefinition {
  pattern: RegExp;
  dllName: string;
  componentName: string;
  packageName: string;
  silentArgs: string[];
  estimatedSizeMB: number;
  localFileNames: string[];
}

const REDIST_DEFINITIONS: RedistDefinition[] = [
  {
    pattern: /MSVCP\d+\.dll|VCRUNTIME\d+\.dll|vcomp\d+\.dll/i,
    dllName: "MSVCP140.dll",
    componentName: "Visual C++ 2015–2022 Redistributable",
    packageName: "VisualCppRedist_AIO_x86_x64.exe",
    silentArgs: ["/y"],
    estimatedSizeMB: 25,
    localFileNames: [
      "VisualCppRedist_AIO_x86_x64.exe",
      "vcredist_x64.exe",
      "vcredist_x86.exe",
      "vcredist_2015-2019_x64.exe",
      "vcredist_2015-2019_x86.exe",
    ],
  },
  {
    pattern:
      /d3dcompiler_\d+\.dll|d3dx9_\d+\.dll|x3daudio1_\d+\.dll|xinput1_\d+\.dll/i,
    dllName: "d3dcompiler_47.dll",
    componentName: "DirectX End-User Runtimes",
    packageName: "dxwebsetup.exe",
    silentArgs: ["/q"],
    estimatedSizeMB: 1,
    localFileNames: [
      "dxwebsetup.exe",
      "directx_Jun2010_redist.exe",
      "DXSETUP.exe",
    ],
  },
  {
    pattern: /mscoree\.dll|clr\.dll|0xc0000135/i,
    dllName: "mscoree.dll",
    componentName: "Microsoft .NET Framework 4.0",
    packageName: "dotNetFx40_Full_setup.exe",
    silentArgs: ["/q", "/norestart"],
    estimatedSizeMB: 48,
    localFileNames: ["dotNetFx40_Full_setup.exe"],
  },
  {
    pattern: /OpenAL32\.dll/i,
    dllName: "OpenAL32.dll",
    componentName: "OpenAL Audio Runtime",
    packageName: "oalinst.exe",
    silentArgs: ["/silent"],
    estimatedSizeMB: 1,
    localFileNames: ["oalinst.exe"],
  },
  {
    pattern: /xnafx\d+\.dll|XNA Framework/i,
    dllName: "xnafx40_redist.msi",
    componentName: "Microsoft XNA Framework 4.0",
    packageName: "xnafx40_redist.msi",
    silentArgs: ["/quiet", "/norestart"],
    estimatedSizeMB: 7,
    localFileNames: ["xnafx40_redist.msi"],
  },
];

export class RedistDetector {
  public static detectFromLog(
    logContent: string,
    gameDirPath?: string | null
  ): DetectedRedist | null {
    if (!logContent) return null;

    for (const def of REDIST_DEFINITIONS) {
      if (def.pattern.test(logContent)) {
        logger.info("RedistDetector identified missing dependency", {
          dllName: def.dllName,
          componentName: def.componentName,
        });

        const localPath = gameDirPath
          ? RedistDetector.findLocalInstaller(gameDirPath, def.localFileNames)
          : null;

        return {
          dllName: def.dllName,
          componentName: def.componentName,
          packageName: def.packageName,
          silentArgs: def.silentArgs,
          estimatedSizeMB: localPath ? 0 : def.estimatedSizeMB,
          localPath,
        };
      }
    }

    return null;
  }

  private static findLocalInstaller(
    gameDirPath: string,
    fileNames: string[]
  ): string | null {
    const candidateDirs = [
      path.join(gameDirPath, "_CommonRedist"),
      path.join(gameDirPath, "Redist"),
      path.join(gameDirPath, "vcredist"),
      gameDirPath,
    ];

    for (const dirPath of candidateDirs) {
      if (!fs.existsSync(dirPath)) continue;

      for (const fileName of fileNames) {
        const fullPath = path.join(dirPath, fileName);
        if (fs.existsSync(fullPath)) {
          logger.info("RedistDetector found local redist installer", {
            fullPath,
          });
          return fullPath;
        }
      }
    }

    return null;
  }
}
