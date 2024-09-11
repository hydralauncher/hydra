import axios from "axios";
import { JSDOM } from "jsdom";
import UserAgent from "user-agents";

export const getFileBuffer = async (url: string) =>
  fetch(url, { method: "GET" }).then((response) =>
    response.arrayBuffer().then((buffer) => Buffer.from(buffer))
  );

export const getFileBase64 = async (url: string) =>
  fetch(url, { method: "GET" }).then((response) =>
    response.arrayBuffer().then((buffer) => {
      const base64 = Buffer.from(buffer).toString("base64");
      const contentType = response.headers.get("content-type");

      return `data:${contentType};base64,${base64}`;
    })
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

export const isPortableVersion = () =>
  process.env.PORTABLE_EXECUTABLE_FILE != null;

export * from "./download-source";
