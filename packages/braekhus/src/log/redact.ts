import { isEqual, isObject, mapValues } from "lodash-es";
import type {
  SerializedRequest,
  SerializedResponse,
} from "pino-std-serializers";

import type { ForwardedRequest, ForwardedResponse } from "../types/index.ts";

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
  /auth|credential|key|passw|secret|session|signature|token/i;

/** Replaces the value of every header not known to be safe to log */
export const redactHeaders = <T extends object>(headers: T) =>
  mapValues(headers, (value, name) =>
    LOGGABLE_HEADERS.has(name.toLowerCase()) ? value : REDACTED
  );

/** Replaces the value of every query parameter whose name suggests a credential */
export const redactQuery = <T>(query: T) =>
  isObject(query)
    ? mapValues(query, (value, name) =>
        SENSITIVE_PARAM_PATTERN.test(name) ? REDACTED : value
      )
    : query;

/** Applies {@link redactQuery} to the query string of a URL or path */
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

// Express's body parsers default a missing body to `{}`; keeping it tells a
// reader that the request had no body
const redactBody = (data: unknown) =>
  data === undefined || isEqual(data, {}) ? data : REDACTED;

export const redactForwardedRequest = (request: ForwardedRequest) => ({
  ...request,
  data: redactBody(request.data),
  headers: redactHeaders(request.headers),
  params: redactQuery(request.params),
});

export const redactForwardedResponse = (response: ForwardedResponse) => ({
  ...response,
  data: redactBody(response.data),
  headers: redactHeaders(response.headers),
});

/** Redacts a request already serialized by pino-std-serializers */
export const redactSerializedRequest = (req: SerializedRequest) => ({
  ...req,
  headers: redactHeaders(req.headers),
  query: redactQuery(req.query),
  url: redactUrl(req.url),
});

/** Redacts a response already serialized by pino-std-serializers */
export const redactSerializedResponse = (res: SerializedResponse) => ({
  ...res,
  headers: redactHeaders(res.headers),
});
