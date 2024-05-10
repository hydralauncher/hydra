import UserAgent from "user-agents";

import type { Repack } from "@main/entity";
import { repackRepository } from "@main/repository";

import { QueryDeepPartialEntity } from "typeorm/query-builder/QueryPartialEntity";

export const saveRepacks = async (repacks: QueryDeepPartialEntity<Repack>[]) =>
  Promise.all(
    repacks.map((repack) => repackRepository.insert(repack).catch(() => {}))
  );

export const requestWebPage = async (url: string) => {
  const userAgent = new UserAgent();

  return fetch(url, {
    method: "GET",
    headers: {
      "User-Agent": userAgent.toString(),
    },
  }).then((response) => response.text());
};

export const decodeNonUtf8Response = async (res: Response) => {
  const contentType = res.headers.get("content-type");
  if (!contentType) return res.text();

  const charset = contentType.substring(contentType.indexOf("charset=") + 8);

  const text = await res.arrayBuffer().then((ab) => {
    const dataView = new DataView(ab);
    const decoder = new TextDecoder(charset);

    return decoder.decode(dataView);
  });

  return text;
};
