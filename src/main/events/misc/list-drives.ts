import { execSync } from "node:child_process";
import { platform } from "node:os";
import { registerEvent } from "../register-event";

const listDrives = async (): Promise<string[]> => {
  if (platform() === "win32") {
    const raw = execSync("wmic logicaldisk get name", {
      encoding: "utf-8",
      timeout: 5000,
    });
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => /^[A-Za-z]:/.test(line))
      .map((drive) => drive.trimEnd());
  }

  return ["/"];
};

registerEvent("listDrives", listDrives);
