import { Cracker } from "@shared";
import { existsSync, createReadStream, readFileSync } from "node:fs";
import readline from "node:readline";

export const parseAchievementFile = async (
  filePath: string,
  type: Cracker
): Promise<any | null> => {
  if (existsSync(filePath)) {
    if (type === Cracker.generic) {
      return genericParse(filePath);
    }

    if (filePath.endsWith(".ini")) {
      return iniParse(filePath);
    }

    if (filePath.endsWith(".json")) {
      return jsonParse(filePath);
    }
  }
};

const genericParse = async (filePath: string) => {
  try {
    const file = createReadStream(filePath);

    const lines = readline.createInterface({
      input: file,
      crlfDelay: Infinity,
    });

    const object: Record<string, Record<string, string | number>> = {};

    for await (const line of lines) {
      if (line.startsWith("###") || !line.length) continue;

      if (line.startsWith("[") && line.endsWith("]")) {
        continue;
      }

      const [name, ...value] = line.split(" = ");
      const objectName = name.slice(1, -1);
      object[objectName] = {};

      const joinedValue = value.join("=").slice(1, -1);

      for (const teste of joinedValue.split(",")) {
        const [name, value] = teste.split("=");
        object[objectName][name.trim()] = value;
      }
    }
    console.log(object);
    return object;
  } catch {
    return null;
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
    const object: Record<string, Record<string, string | number>> = {};

    for await (const line of lines) {
      if (line.startsWith("###") || !line.length) continue;

      if (line.startsWith("[") && line.endsWith("]")) {
        objectName = line.slice(1, -1);
        object[objectName] = {};
      } else {
        const [name, ...value] = line.split("=");
        console.log(line);
        console.log(name, value);

        const joinedValue = value.join("").trim();

        const number = Number(joinedValue);

        object[objectName][name.trim()] = isNaN(number) ? joinedValue : number;
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
