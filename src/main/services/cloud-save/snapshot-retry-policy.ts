import { isAxiosError } from "axios";

export const isCloudSaveCommitTransportFailure = (error: unknown) =>
  (isAxiosError(error) && !error.response) ||
  (error instanceof Error &&
    /Request failed with|ECONN|ETIMEDOUT|timeout|socket hang up/i.test(
      error.message
    ));

export const shouldReprepareCloudSaveSnapshot = (error: unknown) => {
  if (
    error instanceof Error &&
    error.message.includes("cloud_save_upload_url_expired")
  ) {
    return true;
  }
  if (!isAxiosError(error)) return false;
  const payload = JSON.stringify(error.response?.data ?? "");
  return (
    payload.includes("game/cloud-save-pending-snapshot-expired") ||
    payload.includes("game/cloud-save-pending-snapshot-incomplete") ||
    payload.includes("game/cloud-save-pending-snapshot-not-found")
  );
};

export const shouldRetryCloudSaveConflict = (error: unknown, attempt: number) =>
  attempt === 0 && isAxiosError(error) && error.response?.status === 409;
