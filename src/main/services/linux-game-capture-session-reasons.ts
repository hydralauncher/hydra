export type CaptureSessionReason = "souvenir" | "screenshot";

export const addCaptureSessionReason = (
  reasons: ReadonlySet<CaptureSessionReason>,
  reason: CaptureSessionReason
) => new Set([...reasons, reason]);

export const removeCaptureSessionReason = (
  reasons: ReadonlySet<CaptureSessionReason>,
  reason: CaptureSessionReason
) => new Set([...reasons].filter((candidate) => candidate !== reason));
