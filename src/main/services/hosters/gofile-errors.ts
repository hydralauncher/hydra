export const GOFILE_UNEXPECTED_RESPONSE_MESSAGE =
  "Gofile returned an unexpected response";

export class GofileUnexpectedResponseError extends Error {
  constructor(readonly status: number) {
    super(`${GOFILE_UNEXPECTED_RESPONSE_MESSAGE} (HTTP ${status})`);
  }

  get isAuthStatus() {
    return this.status === 401 || this.status === 403;
  }
}
