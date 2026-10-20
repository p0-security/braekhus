import { omit } from "lodash-es";

// Hop-by-hop headers (RFC 9110 §7.6.1) describe a single connection, so a
// proxy must not pass them on to the next one
const HOP_BY_HOP_HEADERS = [
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
];

/**
 * Removes hop-by-hop headers, including any that the `Connection` header names.
 *
 * Expects lowercase header names, as Node and axios provide them.
 */
export const toEndToEndHeaders = <T extends Record<string, unknown>>(
  headers: T
) => {
  const { connection } = headers;
  const named =
    typeof connection === "string"
      ? connection.split(",").map((name) => name.trim().toLowerCase())
      : [];
  return omit(headers, [...HOP_BY_HOP_HEADERS, ...named]);
};
