export class HydraApiRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HydraApiRequestError";
  }
}
