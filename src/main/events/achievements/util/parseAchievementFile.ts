import { existsSync, createReadStream, readFileSync } from "node:fs";
import readline from "node:readline";

export const parseAchievementFile = async (
  filePath: string
): Promise<any | null> => {
  if (existsSync(filePath)) {
    if (filePath.endsWith(".ini")) {
      return iniParse(filePath);
    }

    if (filePath.endsWith(".json")) {
      return jsonParse(filePath);
    }
  }
};

const iniParse = async (filePath: string) => {
  try {
    const file = createReadStream(filePath);

    const lines = readline.createInterface({
      input: file,
      crlfDelay: Infinity,
    });

    let objectName = "";
    const object: any = {};

    for await (const line of lines) {
      if (line.startsWith("###") || !line.length) continue;

      if (line.startsWith("[") && line.endsWith("]")) {
        objectName = line.slice(1, -1);
        object[objectName] = {};
      } else {
        const [name, value] = line.split("=");

        const number = Number(value);

        object[objectName][name] = isNaN(number) ? value : number;
      }
    }

    return object;
  } catch {
    return null;
  }
};

const jsonParse = (filePath: string) => {
  try {
    return JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
};
