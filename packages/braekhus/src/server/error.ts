export class ClientNotFoundError extends Error {
  readonly type = "client_not_found";
  constructor(clientId: string) {
    super(`Client not found: ${clientId}`)
  }
}

export class ChannelNotFoundError extends Error {
  readonly type = "channel_not_found";
  constructor(message: string) {
    super(message);
  }
}
