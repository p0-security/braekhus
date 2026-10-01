// The timeout values are somewhat arbitrary, but the idea is that timed out requests are retried, and
// if the timeout is too short, we might overwhelm the target resource. If the timeout is too long, the
// total response time, including the retry, becomes too long for the user.
// The websocket timeout is longer than the forwarded request timeout: we expect all timeouts to occur
// on the forwarded request, and the websocket timeout is only there to prevent the websocket from hanging
// if the response never returns.
export const DEFAULT_WEBSOCKET_CALL_TIMEOUT_MILLIS = 5000;
export const DEFAULT_FORWARDED_REQUEST_TIMEOUT_MILLIS = 4000;

// Limits on what a websocket peer may send in one message. The payload limit is an estimate of the
// largest filtered Kubernetes API response plus headroom, not a measured value (ENG-8808). ws sends
// each message as a single frame, so the fragment limit only leaves room for proxies that re-split frames.
export const WEBSOCKET_MAX_PAYLOAD_BYTES = 32 * 1024 * 1024;
export const WEBSOCKET_MAX_FRAGMENTS = 64;
// Network reads are rarely smaller than 1 KiB, so a full-size message fits in this many buffered chunks.
export const WEBSOCKET_MAX_BUFFERED_CHUNKS = WEBSOCKET_MAX_PAYLOAD_BYTES / 1024;
