import type { Server } from "node:http";
import request from "supertest";
import type { MockInstance } from "vitest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { Backoff } from "../../client/backoff.ts";
import type { JsonRpcClient } from "../../client/index.ts";
import type { App } from "../index.ts";
import { ensureKey } from "../key-cache.ts";

// Set before the dynamic imports below, because each module creates its
// loggers on load
process.env.LOG_LEVEL = "debug";

const SERVER_RPC_PORT = 18100;
const SERVER_PROXY_PORT = 18101;
const TARGET_PORT = 18102;

const SECRETS = {
  apiKey: "dummy-api-key",
  bearer: "dummy-bearer",
  body: "dummy-request-body",
  cookie: "dummy-cookie",
  customHeader: "dummy-custom-header",
  proxyAuth: "dummy-proxy-auth",
  query: "dummy-query-token",
  responseBody: "dummy-response-body",
  setCookie: "dummy-set-cookie",
};

describe("with debug logging on", () => {
  let server: App;
  let jsonRpcClient: JsonRpcClient;
  let targetServer: Server;
  let stdoutWrite: MockInstance<typeof process.stdout.write>;

  beforeAll(async () => {
    const { runApp } = await import("../index.ts");
    const { JsonRpcClient } = await import("../../client/index.ts");
    const { testHttpServer } = await import("../testing/testExpressApp.ts");
    server = runApp({
      appContext: { rpcPort: SERVER_RPC_PORT, proxyPort: SERVER_PROXY_PORT },
      publicKeyGetter: ensureKey,
    });
    targetServer = testHttpServer(TARGET_PORT);
    jsonRpcClient = new JsonRpcClient(
      {
        targetUrl: `http://localhost:${TARGET_PORT}`,
        clientId: "redactionClientId",
        jwkPath: ".",
      },
      {
        host: "localhost",
        port: SERVER_RPC_PORT,
        insecure: true,
        backoff: new Backoff(500, 500),
      }
    );
    await jsonRpcClient.run();
    await jsonRpcClient.waitUntilConnected();
    // Spied after startup, so only the forwarded request's logs are captured
    stdoutWrite = vi.spyOn(process.stdout, "write");
  });

  afterAll(() => {
    stdoutWrite?.mockRestore();
    jsonRpcClient?.shutdown();
    targetServer?.close();
    server?.expressHttpServer?.close();
    server?.jsonRpcApp?.shutdown();
  });

  it("keeps credentials out of logs, and hop-by-hop headers out of the forwarded request and response", async () => {
    const response = await request(server.expressApp)
      .post(`/client/redactionClientId/echo/headers?token=${SECRETS.query}`)
      .set("authorization", `Bearer ${SECRETS.bearer}`)
      .set("connection", "keep-alive, x-caller-hop")
      .set("cookie", `sid=${SECRETS.cookie}`)
      .set("proxy-authorization", `Basic ${SECRETS.proxyAuth}`)
      .set("te", "trailers")
      .set("x-api-key", SECRETS.apiKey)
      .set("x-caller-hop", "1")
      .set("x-custom-secret", SECRETS.customHeader)
      .send({ secret: SECRETS.responseBody, setCookie: SECRETS.setCookie });

    expect(response.status).toBe(200);
    // End-to-end credentials still reach the target and the caller
    expect(response.body.headers).toEqual(
      expect.arrayContaining(["authorization", "cookie", "x-api-key"])
    );
    expect(response.headers["set-cookie"]).toEqual([SECRETS.setCookie]);
    expect(response.body.headers).not.toContain("proxy-authorization");
    expect(response.body.headers).not.toContain("te");
    expect(response.body.headers).not.toContain("x-caller-hop");
    expect(response.headers).not.toHaveProperty("x-target-hop");

    const logs = stdoutWrite.mock.calls.map(([data]) => String(data)).join("");
    // Guards against a vacuous pass if the logs stop reaching stdout
    expect(logs).toContain('"msg":"forwarded request"');
    expect(logs).toContain('"msg":"forwarded response"');
    for (const secret of Object.values(SECRETS))
      expect(logs).not.toContain(secret);
  });
});
