// The timeout values are somewhat arbitrary, but the idea is that timed out requests are retried, and
// if the timeout is too short, we might overwhelm the target resource. If the timeout is too long, the
// total response time, including the retry, becomes too long for the user.
// The websocket timeout is longer than the forwarded request timeout: we expect all timeouts to occur
// on the forwarded request, and the websocket timeout is only there to prevent the websocket from hanging
// if the response never returns.
export const DEFAULT_WEBSOCKET_CALL_TIMEOUT_MILLIS = 5000;
export const DEFAULT_FORWARDED_REQUEST_TIMEOUT_MILLIS = 4000;
