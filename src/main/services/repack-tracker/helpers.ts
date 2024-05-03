import UserAgent from "user-agents";

import type { Repack } from "@main/entity";
import { repackRepository } from "@main/repository";

import { QueryDeepPartialEntity } from "typeorm/query-builder/QueryPartialEntity";

export const savePage = async (repacks: QueryDeepPartialEntity<Repack>[]) =>
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
