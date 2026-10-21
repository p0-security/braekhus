import { Server, createServer } from "http";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { WebSocket, WebSocketServer } from "ws";

import { JsonRpcClient } from "../../client/index.ts";
import { JsonRpcServer } from "../../server/index.ts";
import { CLIENT_RECEIVE_LIMITS, SERVER_RECEIVE_LIMITS } from "../constants.ts";

const SERVER_PORT = 18095;
const CLIENT_PORT = 18096;

/** A connection to the end under test, from the peer's side */
type Peer = {
  ws: WebSocket;
  /** A request the end answers, proving it still accepts messages */
  request: (bytes: number) => string;
  close: () => void;
};

const nextMessage = (ws: WebSocket) =>
  new Promise<any>((resolve) =>
    ws.once("message", (data) => resolve(JSON.parse(data.toString())))
  );

const closeCode = (ws: WebSocket) =>
  new Promise<number>((resolve) => ws.once("close", resolve));

/** A JSON-RPC request for `method`, padded to exactly `bytes` long */
const paddedRequest = (method: string, bytes: number) => {
  const frame = (pad: string) =>
    JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: [pad] });
  return frame("a".repeat(bytes - frame("").length));
};

const sendFragmented = (ws: WebSocket, message: string, fragments: number) => {
  const size = Math.ceil(message.length / fragments);
  for (let i = 0; i < fragments; i++) {
    const fin = i === fragments - 1;
    ws.send(message.slice(i * size, fin ? undefined : (i + 1) * size), { fin });
  }
};

const serverEnd = () => {
  let server: JsonRpcServer;
  let httpServer: Server;
  return {
    limits: SERVER_RECEIVE_LIMITS,
    setup: async () => {
      server = new JsonRpcServer(
        { noServer: true },
        (_channelId, channel) => channel.addMethod("echo", () => "ok"),
        () => {}
      );
      httpServer = createServer();
      httpServer.on("upgrade", (request, socket, head) =>
        server.handleUpgrade(request, socket, head as Buffer, "testClientId")
      );
      await new Promise((resolve) =>
        httpServer.listen(SERVER_PORT, resolve as () => void)
      );
    },
    teardown: async () => {
      server?.shutdown();
      await new Promise((resolve) => httpServer.close(resolve));
    },
    connect: async (): Promise<Peer> => {
      const ws = new WebSocket(`ws://localhost:${SERVER_PORT}`);
      await new Promise((resolve) => ws.once("open", resolve));
      return {
        ws,
        request: (bytes) => paddedRequest("echo", bytes),
        close: () => ws.close(),
      };
    },
  };
};

const clientEnd = () => {
  let server: WebSocketServer;
  return {
    limits: CLIENT_RECEIVE_LIMITS,
    setup: async () => {
      server = new WebSocketServer({ port: CLIENT_PORT });
    },
    teardown: async () => {
      await new Promise((resolve) => server.close(resolve));
    },
    connect: async (): Promise<Peer> => {
      const connection = new Promise<WebSocket>((resolve) =>
        server.once("connection", resolve)
      );
      const client = new JsonRpcClient(
        {
          targetUrl: "http://localhost:1",
          clientId: "testClientId",
          jwkPath: ".",
        },
        { host: "localhost", port: CLIENT_PORT, insecure: true }
      );
      const ws = await connection;
      // Answer the client's setClientId request so it finishes connecting
      const { id } = await nextMessage(ws);
      ws.send(JSON.stringify({ jsonrpc: "2.0", id, result: { ok: true } }));
      await client.waitUntilConnected();
      return {
        ws,
        // The client answers an unknown method with an error, which is enough
        request: (bytes) => paddedRequest("noSuchMethod", bytes),
        close: () => client.shutdown(),
      };
    },
  };
};

describe.each([
  ["JsonRpcServer", serverEnd()],
  ["JsonRpcClient", clientEnd()],
])("%s receive limits", (_name, end) => {
  const { maxFragments, maxPayload } = end.limits;
  let peer: Peer | undefined;

  beforeAll(end.setup);
  afterAll(end.teardown);
  afterEach(() => peer?.close());

  it("accepts a message of exactly maxPayload bytes", async () => {
    peer = await end.connect();
    const reply = nextMessage(peer.ws);
    peer.ws.send(peer.request(maxPayload));
    await expect(reply).resolves.toMatchObject({ jsonrpc: "2.0", id: 1 });
  });

  it("disconnects a peer that sends a message over maxPayload", async () => {
    peer = await end.connect();
    const closed = closeCode(peer.ws);
    peer.ws.send(peer.request(maxPayload + 1));
    // 1009: Message Too Big
    await expect(closed).resolves.toBe(1009);
  });

  it("accepts a message split into maxFragments frames", async () => {
    peer = await end.connect();
    const reply = nextMessage(peer.ws);
    sendFragmented(peer.ws, peer.request(maxFragments * 16), maxFragments);
    await expect(reply).resolves.toMatchObject({ jsonrpc: "2.0", id: 1 });
  });

  it("disconnects a peer that splits a message into more frames", async () => {
    peer = await end.connect();
    const closed = closeCode(peer.ws);
    sendFragmented(peer.ws, peer.request(maxFragments * 16), maxFragments + 1);
    // 1008: Policy Violation
    await expect(closed).resolves.toBe(1008);
  });
});
