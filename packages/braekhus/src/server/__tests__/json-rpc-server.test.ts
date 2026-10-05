import { Server, createServer } from "http";
import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";

import { JsonRpcServer } from "../index.ts";

const PORT = 18090;

describe("JsonRpcServer", () => {
  let httpServer: Server | undefined;
  let rpcServer: JsonRpcServer | undefined;

  afterEach(() => {
    rpcServer?.shutdown();
    httpServer?.close();
  });

  it("closes a connection that reaches it without an authenticated client ID", async () => {
    const onChannelConnection = vi.fn();
    rpcServer = new JsonRpcServer(
      { noServer: true },
      onChannelConnection,
      () => {}
    );
    const server = rpcServer;
    httpServer = createServer();
    httpServer.on("upgrade", (request, socket, head) => {
      server.handleUpgrade(request, socket, head, undefined as any);
    });
    await new Promise<void>((resolve) => httpServer!.listen(PORT, resolve));

    const socket = new WebSocket(`ws://localhost:${PORT}`);
    await new Promise((resolve, reject) => {
      socket.on("close", resolve);
      socket.on("error", reject);
    });

    expect(onChannelConnection).not.toHaveBeenCalled();
  });
});
