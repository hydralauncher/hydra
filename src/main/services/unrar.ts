import { Extractor, createExtractorFromFile } from "node-unrar-js";
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";

const wasmPath = app.isPackaged
  ? path.join(process.resourcesPath, "unrar.wasm")
  : path.join(__dirname, "..", "..", "unrar.wasm");

const wasmBinary = fs.readFileSync(require.resolve(wasmPath));

export class Unrar {
  private constructor(private extractor: Extractor<Uint8Array>) {}

  static async fromFilePath(filePath: string, targetFolder: string) {
    const extractor = await createExtractorFromFile({
      filepath: filePath,
      targetPath: targetFolder,
      wasmBinary,
    });
    return new Unrar(extractor);
  }

  extract() {
    const files = this.extractor.extract().files;
    for (const file of files) {
      console.log("File:", file.fileHeader.name);
    }
  }
}
