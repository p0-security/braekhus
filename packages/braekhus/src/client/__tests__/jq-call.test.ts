import type { Server } from "node:http";
import { createServer } from "node:http";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import type { WebSocket } from "ws";
import { WebSocketServer } from "ws";

import { JQ_HEADER } from "../../types/index.ts";
import { JQ_MAX_INPUT_BYTES_ENV } from "../filter.ts";
import { JsonRpcClient } from "../index.ts";

const WS_PORT = 18095;
const TARGET_PORT = 18096;

const nextMessage = (ws: WebSocket) =>
  new Promise<any>((resolve) =>
    ws.once("message", (data) => resolve(JSON.parse(data.toString())))
  );

const LIST = { kind: "List", items: [{ name: "a", extra: 1 }] };
const STATUS = { kind: "Status", code: 403, message: "forbidden" };

describe("JsonRpcClient applying the jq filter to forwarded responses", () => {
  let wsServer: WebSocketServer;
  let target: Server;
  let client: JsonRpcClient;
  let ws: WebSocket;
  let nextId = 1;

  const call = async (path: string, filter?: string) => {
    const id = nextId++;
    const reply = nextMessage(ws);
    ws.send(
      JSON.stringify({
        jsonrpc: "2.0",
        id,
        method: "call",
        params: {
          headers: filter === undefined ? {} : { [JQ_HEADER]: filter },
          method: "GET",
          path,
          params: {},
        },
      })
    );
    return reply;
  };

  beforeAll(async () => {
    target = createServer((req, res) => {
      if (req.url === "/text-error") {
        res.writeHead(500, { "content-type": "text/plain" });
        res.end("upstream exploded");
        return;
      }
      if (req.url === "/big") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ items: "x".repeat(10_000) }));
        return;
      }
      const forbidden = req.url === "/forbidden";
      res.writeHead(forbidden ? 403 : 200, {
        "content-type": "application/json",
      });
      res.end(JSON.stringify(forbidden ? STATUS : LIST));
    });
    await new Promise<void>((resolve) => target.listen(TARGET_PORT, resolve));
    wsServer = new WebSocketServer({ port: WS_PORT });
    const connection = new Promise<WebSocket>((resolve) =>
      wsServer.once("connection", resolve)
    );
    client = new JsonRpcClient(
      {
        targetUrl: `http://localhost:${TARGET_PORT}`,
        clientId: "testClientId",
        jwkPath: ".",
      },
      { host: "localhost", port: WS_PORT, insecure: true }
    );
    ws = await connection;
    const { id } = await nextMessage(ws);
    ws.send(JSON.stringify({ jsonrpc: "2.0", id, result: { ok: true } }));
    await client.waitUntilConnected();
  });

  afterAll(async () => {
    client?.shutdown();
    wsServer?.close();
    await new Promise((resolve) => target?.close(resolve));
  });

  it("filters a successful response", async () => {
    const reply = await call("/list", "{ items: [.items[] | { name }] }");

    expect(reply.result).toMatchObject({
      status: 200,
      data: { items: [{ name: "a" }] },
    });
  });

  it("returns an error response from the target unchanged, even if the filter would fail on it", async () => {
    // `.items[]` on a Status object makes jq fail with "Cannot iterate over null"
    const reply = await call("/forbidden", "{ items: [.items[] | { name }] }");

    expect(reply.result).toMatchObject({ status: 403, data: STATUS });
  });

  it("fails the call when the filter cannot be applied to a successful response", async () => {
    const reply = await call("/list", "{ { }");

    expect(reply.result).toBeUndefined();
    expect(reply.error).toMatchObject({
      message: expect.stringContaining("compile error"),
    });
  });

  it("returns a response unchanged when there is no filter", async () => {
    const reply = await call("/list");

    expect(reply.result).toMatchObject({ status: 200, data: LIST });
  });

  it("returns a non-JSON error body as text when there is a filter", async () => {
    const reply = await call("/text-error", ".items");

    expect(reply.result).toMatchObject({
      status: 500,
      data: "upstream exploded",
    });
  });

  describe("input limit", () => {
    beforeEach(() => {
      process.env[JQ_MAX_INPUT_BYTES_ENV] = "1000";
    });
    afterEach(() => {
      delete process.env[JQ_MAX_INPUT_BYTES_ENV];
    });

    it("fails the call when the response is larger than the limit", async () => {
      // `jq .` would succeed on this body, so only the limit can fail it
      const reply = await call("/big", ".");

      expect(reply.result).toBeUndefined();
      expect(reply.error).toMatchObject({
        message: expect.stringContaining("maxContentLength size of 1000"),
      });
    });

    it("does not apply the limit without a filter", async () => {
      const reply = await call("/big");

      expect(reply.result).toMatchObject({ status: 200 });
    });
  });
});
