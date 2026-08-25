const SOUVENIR_SYNC_ERROR_TRANSLATION_KEYS: Record<string, string> = {
  reservation_not_found: "souvenir_sync_error_reservation_not_found",
  reservation_mismatch: "souvenir_sync_error_reservation_mismatch",
  image_key_in_use: "souvenir_sync_error_image_key_in_use",
  achievement_not_found: "souvenir_sync_error_achievement_not_found",
  achievement_already_assigned:
    "souvenir_sync_error_achievement_already_assigned",
  souvenir_payload_mismatch: "souvenir_sync_error_payload_mismatch",
  concurrent_update: "souvenir_sync_error_concurrent_update",
  "achievements/souvenir-upload-deleted": "souvenir_sync_error_upload_deleted",
  "achievements/souvenir-upload-expired":
    "souvenir_sync_error_reservation_not_found",
  "achievements/souvenir-upload-length-mismatch":
    "souvenir_sync_error_upload_length_mismatch",
  "achievements/souvenir-upload-incomplete":
    "souvenir_sync_error_upload_incomplete",
  "achievements/souvenir-limit-reached": "souvenir_sync_error_limit_reached",
};

export const getSouvenirSyncErrorTranslationKeys = (errorCodes: string[]) =>
  Array.from(
    new Set(
      errorCodes
        .map((errorCode) => SOUVENIR_SYNC_ERROR_TRANSLATION_KEYS[errorCode])
        .filter((translationKey): translationKey is string =>
          Boolean(translationKey)
        )
    )
  );
