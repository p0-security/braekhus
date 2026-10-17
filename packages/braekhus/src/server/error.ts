export class ClientNotFoundError extends Error {
  readonly type = "client_not_found";
  constructor(public readonly clientId: string) {
    super(`Client not found: ${clientId}`);
  }
}
