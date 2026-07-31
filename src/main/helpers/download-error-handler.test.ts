import { describe, it } from "node:test";
import assert from "node:assert";
import { AxiosError } from "axios";
import { handleDownloadError } from "./download-error-handler.ts";
import { Downloader, DownloadError } from "../../shared/constants.ts";

const axiosErrorWithResponse = (status: number, data: unknown) => {
  const error = new AxiosError("Request failed");

  error.response = {
    status,
    data,
    statusText: "",
    headers: {},
    config: {} as never,
  };

  return error;
};

describe("handleDownloadError for hydra unlock hosters", () => {
  it("maps a plain-text 400 from vikingfile to subscription required", () => {
    const result = handleDownloadError(
      axiosErrorWithResponse(400, "Active subscription required"),
      Downloader.VikingFile
    );

    assert.deepStrictEqual(result, {
      ok: false,
      error: DownloadError.VikingFileSubscriptionRequired,
    });
  });

  it("maps a json 400 message from vikingfile to subscription required", () => {
    const result = handleDownloadError(
      axiosErrorWithResponse(400, { message: "Active subscription required" }),
      Downloader.VikingFile
    );

    assert.deepStrictEqual(result, {
      ok: false,
      error: DownloadError.VikingFileSubscriptionRequired,
    });
  });

  it("maps a 429 from vikingfile to quota exceeded", () => {
    const result = handleDownloadError(
      axiosErrorWithResponse(429, ""),
      Downloader.VikingFile
    );

    assert.deepStrictEqual(result, {
      ok: false,
      error: DownloadError.VikingFileQuotaExceeded,
    });
  });

  it("maps unlock failures shared by every hoster", () => {
    assert.deepStrictEqual(
      handleDownloadError(
        axiosErrorWithResponse(401, ""),
        Downloader.Datanodes
      ),
      { ok: false, error: DownloadError.HosterUnlockLoginRequired }
    );

    assert.deepStrictEqual(
      handleDownloadError(
        axiosErrorWithResponse(404, ""),
        Downloader.Datanodes
      ),
      { ok: false, error: DownloadError.HosterUnlockFileNotFound }
    );

    assert.deepStrictEqual(
      handleDownloadError(
        axiosErrorWithResponse(502, ""),
        Downloader.VikingFile
      ),
      { ok: false, error: DownloadError.HosterUnlockUnavailable }
    );
  });

  it("leaves downloaders outside the hydra unlock flow untouched", () => {
    const result = handleDownloadError(
      axiosErrorWithResponse(404, ""),
      Downloader.Gofile
    );

    assert.notStrictEqual(
      (result as { error?: string }).error,
      DownloadError.HosterUnlockFileNotFound
    );
  });
});
