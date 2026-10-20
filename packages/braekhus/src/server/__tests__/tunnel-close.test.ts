import { Server, createServer } from "http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocket } from "ws";

import { SERVER_RECEIVE_LIMITS } from "../../common/constants.ts";
import { JsonRpcServer } from "../index.ts";

const PORT = 18097;
const CALL_TIMEOUT_MILLIS = 10000;

describe("JsonRpcServer when a tunnel closes", () => {
  let server: JsonRpcServer;
  let httpServer: Server;
  let channelId: Promise<string>;

  beforeAll(async () => {
    let connected: (channelId: string) => void;
    channelId = new Promise((resolve) => (connected = resolve));
    server = new JsonRpcServer(
      { noServer: true },
      (id) => connected(id),
      () => {}
    );
    httpServer = createServer();
    httpServer.on("upgrade", (request, socket, head) =>
      server.handleUpgrade(request, socket, head as Buffer, "testClientId")
    );
    await new Promise((resolve) =>
      httpServer.listen(PORT, resolve as () => void)
    );
  });

  afterAll(async () => {
    server?.shutdown();
    await new Promise((resolve) => httpServer.close(resolve));
  });

  it("fails calls in flight instead of waiting out the timeout", async () => {
    const ws = new WebSocket(`ws://localhost:${PORT}`);
    // The peer never answers; an oversized message makes the server close the tunnel
    ws.once("message", () =>
      ws.send("a".repeat(SERVER_RECEIVE_LIMITS.maxPayload + 1))
    );
    const options = { timeoutMillis: CALL_TIMEOUT_MILLIS };
    const call = server.call(await channelId, "call", {}, options);
    const started = Date.now();
    await expect(call).rejects.toThrow("Tunnel closed");
    expect(Date.now() - started).toBeLessThan(CALL_TIMEOUT_MILLIS / 2);
  });
});
