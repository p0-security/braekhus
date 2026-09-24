import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";

import { RemoteClientRpcServer } from "../index.ts";

const PORT = 18092;
const HEALTH_CHECK_INTERVAL_MILLIS = 5000;

const nextMessage = (ws: WebSocket) =>
  new Promise<any>((resolve) =>
    ws.once("message", (data) => resolve(JSON.parse(data.toString())))
  );

// Sends setClientId and waits for the reply. The server handles frames in order,
// so a reply also means it has handled any pong the client sent before the request.
const setClientId = async (ws: WebSocket) => {
  const reply = nextMessage(ws);
  ws.send(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "setClientId",
      params: { clientId: "testClientId" },
    })
  );
  await reply;
};

const connect = async (options?: { autoPong: boolean }) => {
  const ws = new WebSocket(`ws://localhost:${PORT}`, options);
  await new Promise((resolve) => ws.once("open", resolve));
  await setClientId(ws);
  return ws;
};

// Runs one health check and waits for the client to see its ping
const heartbeat = async (ws: WebSocket) => {
  const ping = new Promise((resolve) => ws.once("ping", resolve));
  vi.advanceTimersByTime(HEALTH_CHECK_INTERVAL_MILLIS);
  await ping;
};

const callClient = (server: RemoteClientRpcServer) =>
  server.callClientWithRetry("call", {}, "testClientId", {
    timeoutMillis: 100,
  });

describe("JsonRpcServer heartbeat", () => {
  let server: RemoteClientRpcServer;
  let ws: WebSocket;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    server = new RemoteClientRpcServer({ port: PORT });
  });

  afterEach(() => {
    ws?.terminate();
    server?.shutdown();
    vi.useRealTimers();
  });

  it("keeps the route of a client that answers pings", async () => {
    ws = await connect();
    for (let i = 0; i < 3; i++) {
      await heartbeat(ws);
      await setClientId(ws);
    }
    vi.advanceTimersByTime(HEALTH_CHECK_INTERVAL_MILLIS);
    // The route still exists, so the call reaches the client and times out waiting for an answer
    await expect(callClient(server)).rejects.toThrow("Request timeout");
    expect(ws.readyState).toBe(WebSocket.OPEN);
  });

  it("removes the route of a client that misses a ping", async () => {
    ws = await connect({ autoPong: false });
    await heartbeat(ws);
    await setClientId(ws);
    const closed = new Promise((resolve) => ws.once("close", resolve));
    vi.advanceTimersByTime(HEALTH_CHECK_INTERVAL_MILLIS);
    await closed;
    await vi.waitFor(() =>
      expect(callClient(server)).rejects.toThrow(
        "Client not found: testClientId"
      )
    );
  });
});
