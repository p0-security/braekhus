import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";

import { jwt } from "../../client/jwks.ts";
import {
  WEBSOCKET_MAX_FRAGMENTS,
  WEBSOCKET_MAX_PAYLOAD_BYTES,
} from "../../common/constants.ts";
import type { App } from "../index.ts";
import { runApp } from "../index.ts";
import { ensureKey } from "../key-cache.ts";

const SERVER_RPC_PORT = 18090;
const SERVER_PROXY_PORT = 18091;

const connect = async () => {
  const token = await jwt(".", "limitsTestClientId");
  const socket = new WebSocket(`ws://localhost:${SERVER_RPC_PORT}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  return socket;
};

const closeCode = (socket: WebSocket) =>
  new Promise<number>((resolve) => socket.once("close", resolve));

// Splits the message into `count` frames of at least one character each.
const sendFragments = (socket: WebSocket, message: string, count: number) => {
  const size = Math.floor(message.length / count);
  for (let i = 0; i < count; i++) {
    const end = i === count - 1 ? message.length : (i + 1) * size;
    socket.send(message.slice(i * size, end), { fin: i === count - 1 });
  }
};

const request = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "noSuchMethod",
  params: { padding: "x".repeat(WEBSOCKET_MAX_FRAGMENTS * 2) },
});

describe("websocket limits", () => {
  let server: App;

  beforeAll(() => {
    server = runApp({
      appContext: { rpcPort: SERVER_RPC_PORT, proxyPort: SERVER_PROXY_PORT },
      publicKeyGetter: ensureKey,
    });
  });

  afterAll(() => {
    server?.expressHttpServer?.close();
    server?.jsonRpcApp?.shutdown();
  });

  it("closes the connection when a message exceeds the payload limit", async () => {
    const socket = await connect();
    const closed = closeCode(socket);
    socket.send("x".repeat(WEBSOCKET_MAX_PAYLOAD_BYTES + 1));
    expect(await closed).toBe(1009);
  });

  it("closes the connection when a message has too many fragments", async () => {
    const socket = await connect();
    const closed = closeCode(socket);
    sendFragments(socket, request, WEBSOCKET_MAX_FRAGMENTS + 1);
    expect(await closed).toBe(1008);
  });

  it("answers a message split into exactly the fragment limit", async () => {
    const socket = await connect();
    const reply = new Promise<string>((resolve) =>
      socket.once("message", (data) => resolve(data.toString("utf-8")))
    );
    sendFragments(socket, request, WEBSOCKET_MAX_FRAGMENTS);
    expect(JSON.parse(await reply)).toMatchObject({ id: 1, error: {} });
    socket.terminate();
  });
});
