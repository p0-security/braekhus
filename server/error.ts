export class ChannelNotFoundError extends Error {
  readonly type = "channel_not_found";
  constructor(message: string) {
    super(message);
  }
}
