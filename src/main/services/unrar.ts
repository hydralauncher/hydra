import { Extractor, createExtractorFromFile } from 'node-unrar-js';
import fs from 'node:fs';

const wasmBinary = fs.readFileSync(require.resolve('node-unrar-js/esm/js/unrar.wasm'));

export class Unrar {
    private constructor(private extractor: Extractor<Uint8Array>) { }

    static async fromFilePath(filePath: string, targetFolder: string) {
        console.log(filePath, targetFolder);
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
