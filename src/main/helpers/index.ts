import axios from "axios";
import { JSDOM } from "jsdom";
import UserAgent from "user-agents";
import path from "node:path";
import fs from "node:fs";
import { THEMES_PATH } from "@main/constants";

export const getFileBuffer = async (url: string) =>
  fetch(url, { method: "GET" }).then((response) =>
    response.arrayBuffer().then((buffer) => Buffer.from(buffer))
  );

export const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const requestWebPage = async (url: string) => {
  const userAgent = new UserAgent();

  const data = await axios
    .get(url, {
      headers: {
        "User-Agent": userAgent.toString(),
      },
    })
    .then((response) => response.data);

  const { window } = new JSDOM(data);
  return window.document;
};

export const isPortableVersion = () => {
  return !!process.env.PORTABLE_EXECUTABLE_FILE;
};

export const normalizePath = (str: string) =>
  path.posix.normalize(str).replace(/\\/g, "/");

export const addTrailingSlash = (str: string) =>
  str.endsWith("/") ? str : `${str}/`;

export const getThemePath = (themeId: string) =>
  path.join(THEMES_PATH, themeId);

export const getThemeSoundPath = (themeId: string): string | null => {
  const themeDir = getThemePath(themeId);

  if (!fs.existsSync(themeDir)) {
    return null;
  }

  const formats = ["wav", "mp3", "ogg", "m4a"];

  for (const format of formats) {
    const soundPath = path.join(themeDir, `achievement.${format}`);
    if (fs.existsSync(soundPath)) {
      return soundPath;
    }
  }

  return null;
};

export * from "./reg-parser";
