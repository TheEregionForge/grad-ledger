export class UnsupportedPageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedPageError";
  }
}
