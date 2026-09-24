import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { WebSocket } from "ws";
import { WebSocketServer } from "ws";

import { JsonRpcClient } from "../index.ts";

const PORT = 18091;

const nextMessage = (ws: WebSocket) =>
  new Promise<any>((resolve) =>
    ws.once("message", (data) => resolve(JSON.parse(data.toString())))
  );

describe("JsonRpcClient receiving a malformed message", () => {
  let server: WebSocketServer;
  let client: JsonRpcClient;
  let ws: WebSocket;

  beforeAll(async () => {
    server = new WebSocketServer({ port: PORT });
    const connection = new Promise<WebSocket>((resolve) =>
      server.once("connection", resolve)
    );
    client = new JsonRpcClient(
      {
        targetUrl: "http://localhost:1",
        clientId: "testClientId",
        jwkPath: ".",
      },
      { host: "localhost", port: PORT, insecure: true }
    );
    ws = await connection;
    // Answer the client's setClientId request so it finishes connecting
    const { id } = await nextMessage(ws);
    ws.send(JSON.stringify({ jsonrpc: "2.0", id, result: { ok: true } }));
    await client.waitUntilConnected();
  });

  afterAll(() => {
    client?.shutdown();
    server?.close();
  });

  // Vitest fails the run on an uncaught exception or unhandled rejection, which is what these messages caused
  it.each([
    ["text that is not JSON", "not json"],
    ["JSON that is not JSON-RPC", '{"foo":1}'],
    ["a JSON array of non-messages", "[1,2]"],
    ["JSON null", "null"],
  ])("keeps serving the connection after %s", async (_name, frame) => {
    ws.send(frame);
    const reply = nextMessage(ws);
    ws.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "noSuchMethod" }));
    await expect(reply).resolves.toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32601 },
    });
  });
});
