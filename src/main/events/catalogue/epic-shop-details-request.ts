import { isAxiosError } from "axios";
import { HydraApiRequestError } from "../../services/hydra-api-request-error.js";

const HTTP_SERVER_ERROR_STATUS = 500;

export async function fetchEpicShopDetailsWithCache<TRemote, TCached>(
  request: () => Promise<TRemote>,
  readCache: () => Promise<TCached | null | undefined>
): Promise<
  { source: "remote"; data: TRemote } | { source: "cache"; data: TCached }
> {
  try {
    return { source: "remote", data: await request() };
  } catch (error) {
    const isServerError =
      isAxiosError(error) &&
      (!error.response || error.response.status >= HTTP_SERVER_ERROR_STATUS);

    if (!(error instanceof HydraApiRequestError) && !isServerError) {
      throw error;
    }

    const cached = await readCache();
    if (!cached) throw error;

    return { source: "cache", data: cached };
  }
}
