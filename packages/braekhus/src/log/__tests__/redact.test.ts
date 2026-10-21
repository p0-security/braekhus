import { pino } from "pino";
import { describe, expect, it } from "vitest";

import { REDACTED, redactOptions, redactUrl } from "../redact.ts";

/** Logs `object` through a pino logger with {@link redactOptions}, and returns what it wrote */
const logged = (object: object) => {
  const lines: string[] = [];
  pino({ redact: redactOptions }, { write: (line) => lines.push(line) }).info(
    object
  );
  return JSON.parse(lines[0] ?? "{}");
};

describe("redactOptions", () => {
  it("keeps only allowlisted header values, matching names case-insensitively", () => {
    expect(
      logged({
        req: {
          headers: {
            authorization: "Bearer abc",
            "Content-Type": "application/json",
            cookie: "sid=abc",
            "x-api-key": "abc",
          },
        },
        res: { headers: { "content-length": "2", "set-cookie": ["a=1"] } },
      })
    ).toMatchObject({
      req: {
        headers: {
          authorization: REDACTED,
          "Content-Type": "application/json",
          cookie: REDACTED,
          "x-api-key": REDACTED,
        },
      },
      res: { headers: { "content-length": "2", "set-cookie": REDACTED } },
    });
  });

  it("redacts query parameters whose names suggest a credential", () => {
    expect(
      logged({
        req: {
          query: { access_token: "abc", labelSelector: "app=x" },
          url: "/client/c/api?access_token=abc&labelSelector=app%3Dx",
        },
        request: { params: { "X-Amz-Signature": "abc", limit: "10" } },
      })
    ).toMatchObject({
      req: {
        query: { access_token: REDACTED, labelSelector: "app=x" },
        url: `/client/c/api?access_token=${REDACTED}&labelSelector=app%3Dx`,
      },
      request: { params: { "X-Amz-Signature": REDACTED, limit: "10" } },
    });
  });

  it("redacts forwarded request and response bodies and headers", () => {
    expect(
      logged({
        request: {
          data: { password: "abc" },
          headers: { authorization: "Bearer abc", host: "example.com" },
          method: "POST",
          path: "/api",
        },
        response: {
          data: "secret",
          headers: { "x-upstream-token": "abc" },
          status: 200,
        },
      })
    ).toEqual(
      expect.objectContaining({
        request: {
          data: REDACTED,
          headers: { authorization: REDACTED, host: "example.com" },
          method: "POST",
          path: "/api",
        },
        response: {
          data: REDACTED,
          headers: { "x-upstream-token": REDACTED },
          status: 200,
        },
      })
    );
  });

  it("keeps an empty body", () => {
    expect(logged({ request: { data: {} } })).toMatchObject({
      request: { data: {} },
    });
  });
});

describe("redactUrl", () => {
  it.each([
    ["/api/v1/pods", "/api/v1/pods"],
    ["/api?limit=10", "/api?limit=10"],
    [
      "/api?token=abc&labelSelector=app%3Dx&password",
      `/api?token=${REDACTED}&labelSelector=app%3Dx&password=${REDACTED}`,
    ],
    ["/api?a=b&secret=x=y", `/api?a=b&secret=${REDACTED}`],
  ])("redacts %s", (url, expected) => {
    expect(redactUrl(url)).toBe(expected);
  });
});
