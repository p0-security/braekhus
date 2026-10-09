import { afterEach, describe, expect, it, vi } from "vitest";

import type { ClientConnectedListener } from "../../types/index.ts";
import { RemoteClientRpcServer } from "../index.ts";
import {
  nextMessage,
  openAuthenticatedSocket,
} from "../testing/authenticated-socket.ts";

const PORT = 18095;
const CLIENT_ID = "testClientId";

const setClientIdRequest = (clientId: string) =>
  JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "setClientId",
    params: { clientId },
  });

describe("RemoteClientRpcServer onClientConnected", () => {
  let close: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await close?.();
    close = undefined;
  });

  const connect = async (onClientConnected: ClientConnectedListener) => {
    const server = new RemoteClientRpcServer(
      { noServer: true },
      { onClientConnected }
    );
    const socket = await openAuthenticatedSocket(server, PORT, CLIENT_ID);
    close = socket.close;
    return { server, ws: socket.ws };
  };

  it.each([
    ["succeeds", async () => {}],
    [
      "throws",
      () => {
        throw new Error("sync failure");
      },
    ],
    ["rejects", async () => Promise.reject(new Error("async failure"))],
    // Never settles: setClientId must not wait on it
    ["never settles", () => new Promise<void>(() => {})],
  ])(
    "registers the channel and answers setClientId when the listener %s",
    async (_name, impl) => {
      const listener = vi.fn<ClientConnectedListener>(impl);
      const { server, ws } = await connect(listener);

      const reply = nextMessage(ws);
      ws.send(setClientIdRequest(CLIENT_ID));

      await expect(reply).resolves.toEqual({
        jsonrpc: "2.0",
        id: 1,
        result: { ok: true },
      });
      expect(listener).toHaveBeenCalledExactlyOnceWith(CLIENT_ID);
      // Routable: the call reaches the channel instead of "Client not found"
      const routed = server.callClientWithRetry("ping", {}, CLIENT_ID, {
        timeoutMillis: 50,
      });
      await expect(routed).rejects.not.toThrow(/Client not found/);
    }
  );

  it("does not notify when setClientId is rejected", async () => {
    const listener = vi.fn<ClientConnectedListener>();
    const { ws } = await connect(listener);

    const reply = nextMessage(ws);
    ws.send(setClientIdRequest("otherClientId"));

    await expect(reply).resolves.toMatchObject({ id: 1, error: {} });
    expect(listener).not.toHaveBeenCalled();
  });
});
