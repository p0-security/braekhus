import { describe, expect, it } from "vitest";

import { toEndToEndHeaders } from "../headers.ts";

describe("toEndToEndHeaders", () => {
  it("removes standard hop-by-hop headers", () => {
    expect(
      toEndToEndHeaders({
        authorization: "Bearer abc",
        connection: "keep-alive",
        "keep-alive": "timeout=5",
        "proxy-authorization": "Basic abc",
        te: "trailers",
        "transfer-encoding": "chunked",
        upgrade: "websocket",
      })
    ).toEqual({ authorization: "Bearer abc" });
  });

  it("removes headers that the Connection header names", () => {
    expect(
      toEndToEndHeaders({
        connection: "close, X-Hop ,x-other",
        "content-type": "text/plain",
        "x-hop": "1",
        "x-other": "2",
      })
    ).toEqual({ "content-type": "text/plain" });
  });
});
