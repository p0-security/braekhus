export class NotFoundError extends Error {
  readonly type = "not_found";
  constructor(
    public readonly id: string,
    public readonly mode: "channel" | "client"
  ) {
    super(`${mode} not found: ${id}`);
  }
}
