import { isEqual } from "lodash-es";
import type { LoggerOptions } from "pino";

export const REDACTED = "<REDACTED>";

// An allowlist, because targets and callers can carry credentials under any
// custom header name (e.g. `x-api-key`, `x-goog-iap-jwt-assertion`)
const LOGGABLE_HEADERS = new Set([
  "accept",
  "accept-encoding",
  "accept-language",
  "audit-id",
  "cache-control",
  "connection",
  "content-encoding",
  "content-length",
  "content-type",
  "date",
  "etag",
  "host",
  "keep-alive",
  "transfer-encoding",
  "user-agent",
  "vary",
  "x-request-id",
]);

// A denylist, because query parameters carry routine debugging context (e.g.
// Kubernetes label selectors), and credentials in them use recognizable names
const SENSITIVE_PARAM_PATTERN =
  /auth|credential|key|passw|password|secret|session|signature|token/i;

const redactParam = (value: unknown, name: string) =>
  SENSITIVE_PARAM_PATTERN.test(name) ? REDACTED : value;

/** Redacts the values of sensitive query parameters in a URL or path */
export const redactUrl = (url: string) => {
  const iQuery = url.indexOf("?");
  if (iQuery < 0) return url;
  const params = url
    .slice(iQuery + 1)
    .split("&")
    .map((param) => {
      const [name = ""] = param.split("=", 1);
      return SENSITIVE_PARAM_PATTERN.test(name) ? `${name}=${REDACTED}` : param;
    });
  return `${url.slice(0, iQuery)}?${params.join("&")}`;
};

// Censors keyed by the field each redacted path passes through
const CENSORS: Record<string, (value: unknown, name: string) => unknown> = {
  // Express's body parsers default a missing body to `{}`; keeping it tells a
  // reader that the request had no body
  data: (value) => (isEqual(value, {}) ? value : REDACTED),
  headers: (value, name) =>
    LOGGABLE_HEADERS.has(name.toLowerCase()) ? value : REDACTED,
  params: redactParam,
  query: redactParam,
  url: (value) => (typeof value === "string" ? redactUrl(value) : REDACTED),
};

/**
 * pino `redact` options that keep credentials and bodies out of logged HTTP
 * requests and responses.
 *
 * Covers pino-http's `req` and `res`, and the forwarded `request` and
 * `response` objects braekhus logs.
 */
export const redactOptions = {
  paths: [
    "req.headers.*",
    "req.query.*",
    "req.url",
    "res.headers.*",
    "request.data",
    "request.headers.*",
    "request.params.*",
    "response.data",
    "response.headers.*",
  ],
  censor: (value: unknown, path: string[]) => {
    const [, field = "", name = ""] = path;
    // Fails closed if a path is added without a censor
    return CENSORS[field]?.(value, name) ?? REDACTED;
  },
} satisfies LoggerOptions["redact"];
