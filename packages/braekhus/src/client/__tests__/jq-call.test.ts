import type { Server } from "node:http";
import { createServer } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { WebSocket } from "ws";
import { WebSocketServer } from "ws";

import { JQ_HEADER } from "../../types/index.ts";
import { JsonRpcClient } from "../index.ts";

const WS_PORT = 18098;
const TARGET_PORT = 18099;

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

  const call = async (path: string, filter: string) => {
    const id = nextId++;
    const reply = nextMessage(ws);
    ws.send(
      JSON.stringify({
        jsonrpc: "2.0",
        id,
        method: "call",
        params: {
          headers: { [JQ_HEADER]: filter },
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

  it("returns an error response from the target unchanged, even if the filter would succeed on it", async () => {
    // Without the skip this would return { items: [] } for the 403 body
    const reply = await call("/forbidden", "{ items: [.items // [] | .[]] }");

    expect(reply.result).toMatchObject({ status: 403, data: STATUS });
  });
});
