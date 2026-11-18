import type { Server } from "http";
import { Server as NetServer } from "net";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WebSocket } from "ws";
import { WebSocketServer } from "ws";

import { startHealthServer } from "../health.ts";
import { JsonRpcClient } from "../index.ts";

const TUNNEL_PORT = 18130;
const HEALTH_PORT = 18131;

const status = async (path: string) =>
  (await fetch(`http://localhost:${HEALTH_PORT}${path}`)).status;

const startClient = () =>
  new JsonRpcClient(
    { targetUrl: "http://localhost:1", clientId: "testClientId", jwkPath: "." },
    { host: "localhost", port: TUNNEL_PORT, insecure: true }
  );

// Plays P0's side: accepts the tunnel and hands back a function that answers
// the client's setClientId request, which is what completes the connection
const acceptTunnel = (tunnel: WebSocketServer) =>
  new Promise<{ ws: WebSocket; confirm: () => void }>((resolve) =>
    tunnel.once("connection", (ws) =>
      ws.once("message", (data) => {
        const { id } = JSON.parse(data.toString());
        const result = { jsonrpc: "2.0", id, result: { ok: true } };
        resolve({ ws, confirm: () => ws.send(JSON.stringify(result)) });
      })
    )
  );

describe("client health port", () => {
  let tunnel: WebSocketServer | undefined;
  let client: JsonRpcClient | undefined;
  let health: Server | undefined;

  afterEach(async () => {
    vi.restoreAllMocks();
    client?.shutdown();
    health?.close();
    await new Promise((resolve) =>
      tunnel ? tunnel.close(resolve) : resolve(undefined)
    );
  });

  it("reports live throughout and ready only while the tunnel is connected", async () => {
    tunnel = new WebSocketServer({ port: TUNNEL_PORT });
    const connection = acceptTunnel(tunnel);
    client = startClient();
    const c = client;
    health = startHealthServer(HEALTH_PORT, () => c.isConnected());
    await new Promise((resolve) => health!.once("listening", resolve));

    const { ws, confirm } = await connection;
    expect(await status("/live")).toBe(200);
    expect(await status("/ready")).toBe(503);

    confirm();
    await client.waitUntilConnected();
    expect(await status("/live")).toBe(200);
    expect(await status("/ready")).toBe(200);

    ws.terminate();
    await vi.waitFor(async () => expect(await status("/ready")).toBe(503));
    expect(await status("/live")).toBe(200);
  });

  it("opens no listener on its own", async () => {
    tunnel = new WebSocketServer({ port: TUNNEL_PORT });
    const connection = acceptTunnel(tunnel);
    const listen = vi.spyOn(NetServer.prototype, "listen");
    client = startClient();
    (await connection).confirm();
    await client.waitUntilConnected();
    expect(listen).not.toHaveBeenCalled();
  });
});
