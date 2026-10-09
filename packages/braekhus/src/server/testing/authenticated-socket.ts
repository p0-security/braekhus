import { Server, createServer } from "http";
import { WebSocket } from "ws";

import type { JsonRpcServer } from "../index.ts";

/** Resolves with the next JSON message `ws` receives. */
export const nextMessage = (ws: WebSocket) =>
  new Promise<any>((resolve) =>
    ws.once("message", (data) => resolve(JSON.parse(data.toString())))
  );

/**
 * Serves `server`'s upgrades on `port`, treating every connection as
 * authenticated as `clientId`, and opens one client socket to it. Call
 * `close` to tear down the socket, `server`, and the HTTP listener.
 */
export const openAuthenticatedSocket = async (
  server: JsonRpcServer,
  port: number,
  clientId: string
) => {
  const httpServer: Server = createServer();
  httpServer.on("upgrade", (request, socket, head) =>
    server.handleUpgrade(request, socket, head as Buffer, clientId)
  );
  await new Promise((resolve) =>
    httpServer.listen(port, resolve as () => void)
  );
  const ws = new WebSocket(`ws://localhost:${port}`);
  await new Promise((resolve) => ws.once("open", resolve));
  const close = async () => {
    ws.close();
    server.shutdown();
    // Closing is asynchronous; the port stays bound until it completes
    await new Promise((resolve) => httpServer.close(() => resolve(undefined)));
  };
  return { ws, close };
};
