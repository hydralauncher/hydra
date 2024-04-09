import axios, { RawAxiosRequestHeaders } from "axios";
import { requestWebPage } from "./repack-tracker/helpers";
import { stateManager } from "@main/state-manager";

export interface AlgoliaResponse<T> {
  hits: T[];
}

export interface AlgoliaSearchParams {
  index: string;
  query: string;
  params?: Record<string, string>;
  headers?: RawAxiosRequestHeaders;
}

export const getSteamDBAlgoliaCredentials = async () => {
  const js = await requestWebPage(
    "https://steamdb.info/static/js/instantsearch.js"
  );

  const algoliaCredentialsRegExp = new RegExp(
    /algoliasearch\("(.*?)","(.*?)"\);/
  );

  const [, applicationId, apiKey] = algoliaCredentialsRegExp.exec(js);

  return { applicationId, apiKey };
};

export const searchAlgolia = async <T>(
  params: AlgoliaSearchParams
): Promise<AlgoliaResponse<T>> => {
  const algoliaCredentials = stateManager.getValue("steamDBAlgoliaCredentials");

  const searchParams = new URLSearchParams({
    "x-algolia-agent":
      "Algolia for JavaScript (4.13.1); Browser (lite); JS Helper (3.9.0); react (18.1.0); react-instantsearch (6.29.0)",
    "x-algolia-application-id": algoliaCredentials.applicationId,
    "x-algolia-api-key": algoliaCredentials.apiKey,
    query: params.query,
    ...params.params,
  });

  return axios
    .get(
      `https://${algoliaCredentials.applicationId.toLowerCase()}-dsn.algolia.net/1/indexes/${
        params.index
      }?${searchParams.toString()}`,
      {
        headers: params.headers,
      }
    )
    .then((response) => response.data);
};
