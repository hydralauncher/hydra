export const getCloudSaveErrorDetails = (error: unknown) => {
  const rawErrorCode =
    error && typeof error === "object" && "code" in error
      ? error.code
      : undefined;
  const errorMessage = error instanceof Error ? error.message : "Unknown error";
  const nativeErrorCode = errorMessage.match(/\bcloud_save_[a-z0-9_]+\b/)?.[0];
  const errorCode =
    typeof rawErrorCode === "string" || typeof rawErrorCode === "number"
      ? rawErrorCode
      : nativeErrorCode;

  return {
    errorName: error instanceof Error ? error.name : "UnknownError",
    errorMessage,
    errorCode,
  };
};
