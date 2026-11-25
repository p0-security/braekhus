import type { Server } from "node:http";
import { createServer } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { WebSocket } from "ws";
import { WebSocketServer } from "ws";

import { JsonRpcClient } from "../index.ts";

const WS_PORT = 18130;
const TARGET_PORT = 18131;

const nextMessage = (ws: WebSocket) =>
  new Promise<any>((resolve) =>
    ws.once("message", (data) => resolve(JSON.parse(data.toString())))
  );

type Received = { contentLength: string | undefined; body: string };

// The server forwards Express's parsed body, which is `{}` even when the
// incoming request had none. Google's front end rejects a GET with a body.
describe("JsonRpcClient forwarding a request body", () => {
  let wsServer: WebSocketServer;
  let target: Server;
  let client: JsonRpcClient;
  let ws: WebSocket;
  let received: Received | undefined;
  let nextId = 1;

  const call = async (method: string, data: unknown) => {
    const id = nextId++;
    const reply = nextMessage(ws);
    ws.send(
      JSON.stringify({
        jsonrpc: "2.0",
        id,
        method: "call",
        params: {
          headers: { "content-type": "application/json" },
          method,
          path: "/echo",
          params: {},
          data,
        },
      })
    );
    return reply;
  };

  beforeAll(async () => {
    target = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        received = {
          contentLength: req.headers["content-length"],
          body: Buffer.concat(chunks).toString("utf-8"),
        };
        res.writeHead(200, { "content-type": "application/json" });
        res.end("{}");
      });
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

  it.each(["GET", "HEAD"])("sends no body on %s", async (method) => {
    received = undefined;
    const { result } = await call(method, {});
    expect(result.status).toBe(200);
    expect(received).toEqual({ contentLength: undefined, body: "" });
  });

  it.each(["POST", "PUT", "PATCH", "DELETE"])(
    "forwards the body on %s",
    async (method) => {
      received = undefined;
      const { result } = await call(method, { a: 1 });
      expect(result.status).toBe(200);
      expect(received).toEqual({ contentLength: "7", body: '{"a":1}' });
    }
  );
});
