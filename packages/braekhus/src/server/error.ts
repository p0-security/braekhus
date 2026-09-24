export class ChannelNotFoundError extends Error {
  readonly type = "channel_not_found";
  constructor(message: string) {
    super(message);
  }
}

export class ClientNotFoundError extends Error {}

/** True when the request failed before it was sent to the client, so retrying cannot repeat it. */
export const isUnsentError = (error: unknown) =>
  error instanceof ChannelNotFoundError || error instanceof ClientNotFoundError;
