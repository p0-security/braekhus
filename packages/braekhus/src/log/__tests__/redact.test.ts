import { describe, expect, it } from "vitest";

import {
  REDACTED,
  redactForwardedRequest,
  redactForwardedResponse,
  redactHeaders,
  redactQuery,
  redactUrl,
} from "../redact.ts";

describe("redactHeaders", () => {
  it("keeps only allowlisted header values, matching names case-insensitively", () => {
    expect(
      redactHeaders({
        Authorization: "Bearer abc",
        "Content-Type": "application/json",
        cookie: "sid=abc",
        "set-cookie": ["a=1", "b=2"],
        "x-api-key": "abc",
      })
    ).toEqual({
      Authorization: REDACTED,
      "Content-Type": "application/json",
      cookie: REDACTED,
      "set-cookie": REDACTED,
      "x-api-key": REDACTED,
    });
  });
});

describe("redactQuery", () => {
  it("redacts parameters whose names suggest a credential", () => {
    expect(
      redactQuery({
        access_token: "abc",
        apiKey: "abc",
        labelSelector: "app=x",
        limit: "10",
        "X-Amz-Signature": "abc",
      })
    ).toEqual({
      access_token: REDACTED,
      apiKey: REDACTED,
      labelSelector: "app=x",
      limit: "10",
      "X-Amz-Signature": REDACTED,
    });
  });

  it("passes through a missing query", () => {
    expect(redactQuery(undefined)).toBeUndefined();
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

describe("redactForwardedRequest", () => {
  it("redacts headers, params, and body", () => {
    expect(
      redactForwardedRequest({
        data: { password: "abc" },
        headers: { authorization: "Bearer abc", host: "example.com" },
        method: "POST",
        params: { token: "abc", watch: "true" },
        path: "/api",
      })
    ).toEqual({
      data: REDACTED,
      headers: { authorization: REDACTED, host: "example.com" },
      method: "POST",
      params: { token: REDACTED, watch: "true" },
      path: "/api",
    });
  });

  it.each([[undefined], [{}]])("keeps an empty body %s", (data) => {
    expect(
      redactForwardedRequest({
        data,
        headers: {},
        method: "GET",
        params: {},
        path: "/",
      }).data
    ).toEqual(data);
  });
});

describe("redactForwardedResponse", () => {
  it("redacts headers and body", () => {
    expect(
      redactForwardedResponse({
        data: "secret",
        headers: { "content-length": "6", "set-cookie": ["sid=abc"] },
        status: 200,
        statusText: "OK",
      })
    ).toEqual({
      data: REDACTED,
      headers: { "content-length": "6", "set-cookie": REDACTED },
      status: 200,
      statusText: "OK",
    });
  });
});
