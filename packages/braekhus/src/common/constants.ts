// The timeout values are somewhat arbitrary, but the idea is that timed out requests are retried, and
// if the timeout is too short, we might overwhelm the target resource. If the timeout is too long, the
// total response time, including the retry, becomes too long for the user.
// The websocket timeout is longer than the forwarded request timeout: we expect all timeouts to occur
// on the forwarded request, and the websocket timeout is only there to prevent the websocket from hanging
// if the response never returns.
export const DEFAULT_WEBSOCKET_CALL_TIMEOUT_MILLIS = 5000;
export const DEFAULT_FORWARDED_REQUEST_TIMEOUT_MILLIS = 4000;

// Matches the agentic gateway's own 1 MB limit; express's 100 KB default
// rejects large MCP server definitions on their way to the gateway.
export const MAX_FORWARDED_REQUEST_BODY_BYTES = 1024 * 1024;

// A peer that exceeds any of these is disconnected: close code 1009 for an
// oversized message, 1008 for the other two.
const receiveLimits = (maxPayload: number) => ({
  maxPayload,
  // ws sends each message as one frame, so a well-behaved peer never
  // fragments; this only bounds a hostile one (GHSA-96hv-2xvq-fx4p).
  maxFragments: 1024,
  // Bounds a frame trickled in tiny TCP writes (same advisory). Real traffic
  // arrives in chunks far larger than the 1 KiB average this allows.
  maxBufferedChunks: maxPayload / 1024,
});

// The server receives forwarded responses. The largest P0 asks for are
// agentic gateway catalog pages (100 MCP server definitions with their tool
// lists) and activity log pages, a few MB at most; this leaves headroom while
// keeping each client well under the library's 100 MiB default.
export const SERVER_RECEIVE_LIMITS = receiveLimits(32 * 1024 * 1024);

// The client receives forwarded requests, whose bodies the proxy caps; the
// rest is headers and the JSON-RPC envelope.
export const CLIENT_RECEIVE_LIMITS = receiveLimits(
  2 * MAX_FORWARDED_REQUEST_BODY_BYTES
);
