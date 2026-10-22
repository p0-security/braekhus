import * as jose from "jose";
import {
  JSONRPCClient,
  JSONRPCServer,
  JSONRPCServerAndClient,
} from "json-rpc-2.0";
import { once } from "node:events";
import http from "node:http";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { WebSocket } from "ws";

import type { ForwardedResponse } from "../../types/index.ts";
import { deferral } from "../../util/deferral.ts";
import type { App } from "../index.ts";
import { runApp } from "../index.ts";
import {
  DRAIN_TIMEOUT_MILLIS,
  SERVICE_RESTART_CLOSE_CODE,
} from "../shutdown.ts";

const RPC_PORT = 18110;
const PROXY_PORT = 18111;
const CLIENT_ID = "testClientId";
// Longer than the 5.75 s of retry sleeps one proxied request can spend
const SLOW_REQUEST_MILLIS = 6000;

let privateKey: jose.KeyLike;
let publicKey: jose.JWK;

const authHeaders = async () => ({
  Authorization: `Bearer ${await new jose.SignJWT({})
    .setProtectedHeader({ alg: "ES384" })
    .setSubject(CLIENT_ID)
    .setAudience("p0.dev")
    .sign(privateKey)}`,
});

const ok = (headers: Record<string, string>): ForwardedResponse => ({
  status: 200,
  statusText: "OK",
  headers,
  data: "done",
});

const openTunnel = async (call: () => Promise<ForwardedResponse>) => {
  const ws = new WebSocket(`ws://localhost:${RPC_PORT}`, {
    headers: await authHeaders(),
  });
  const channel = new JSONRPCServerAndClient(
    new JSONRPCServer(),
    new JSONRPCClient((request) => {
      ws.send(JSON.stringify(request));
      return Promise.resolve();
    })
  );
  channel.addMethod("call", call);
  ws.on(
    "message",
    (data) => void channel.receiveAndSend(JSON.parse(data.toString()))
  );
  const closed = new Promise<{ code: number; reason: string }>((resolve) =>
    ws.once("close", (code, reason) =>
      resolve({ code, reason: reason.toString() })
    )
  );
  await once(ws, "open");
  await channel.request("setClientId", { clientId: CLIENT_ID });
  return { ws, closed };
};

const get = (agent: http.Agent) =>
  new Promise<{ status?: number; body: string; connection?: string }>(
    (resolve, reject) => {
      http
        .get(
          { port: PROXY_PORT, path: `/client/${CLIENT_ID}/`, agent },
          (res) => {
            let body = "";
            res.setEncoding("utf8");
            res.on("data", (chunk) => (body += chunk));
            res.on("end", () =>
              resolve({
                status: res.statusCode,
                body,
                connection: res.headers.connection,
              })
            );
          }
        )
        .on("error", reject);
    }
  );

const startDrain = (app: App) => {
  const state = { done: false };
  const drained = app.drain().then(() => {
    state.done = true;
  });
  return { state, drained };
};

describe("drain", () => {
  let app: App;
  let agent: http.Agent;
  let tunnel: Awaited<ReturnType<typeof openTunnel>> | undefined;

  beforeAll(async () => {
    const pair = await jose.generateKeyPair("ES384");
    privateKey = pair.privateKey;
    publicKey = await jose.exportJWK(pair.publicKey);
  });

  beforeEach(async () => {
    // Sockets and streams keep real time. Only the drain timers and the RPC timeout are fake.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    app = runApp({
      appContext: { rpcPort: RPC_PORT, proxyPort: PROXY_PORT },
      publicKeyGetter: async () => publicKey,
      // Outlasts every clock advance below, so a held request stays in flight
      callOptions: { timeoutMillis: 60_000 },
    });
    agent = new http.Agent({ keepAlive: true });
    await once(app.expressHttpServer, "listening");
  });

  afterEach(() => {
    vi.useRealTimers();
    agent.destroy();
    tunnel?.ws.terminate();
    tunnel = undefined;
    app.expressHttpServer.closeAllConnections();
    app.expressHttpServer.close();
    app.jsonRpcApp.shutdown();
  });

  it.each([
    ["no Connection header", {}, "close"],
    // Connection is hop-by-hop, so the proxy drops the target's and the drain's wins
    ["Connection: keep-alive", { connection: "keep-alive" }, "close"],
  ])(
    "finishes an in-flight keep-alive request whose target sent %s, then closes tunnels",
    async (_name, headers, connection) => {
      const called = deferral();
      const release = deferral();
      tunnel = await openTunnel(async () => {
        called.resolve();
        await release.promise;
        return ok(headers);
      });
      const response = get(agent);
      await called.promise;

      const { state, drained } = startDrain(app);
      await vi.advanceTimersByTimeAsync(SLOW_REQUEST_MILLIS);
      expect(state.done).toBe(false);

      release.resolve();
      await expect(response).resolves.toEqual({
        status: 200,
        body: "done",
        connection,
      });
      await expect(tunnel.closed).resolves.toEqual({
        code: SERVICE_RESTART_CLOSE_CODE,
        reason: "Server shutting down",
      });
      await drained;
    }
  );

  it("refuses new tunnels once the drain starts", async () => {
    const drained = app.drain();

    const refused = new WebSocket(`ws://localhost:${RPC_PORT}`, {
      headers: await authHeaders(),
    });
    // localhost resolves to IPv4 and IPv6, so the error is an AggregateError with an empty message
    await expect(once(refused, "open")).rejects.toMatchObject({
      code: "ECONNREFUSED",
    });
    await drained;
  });

  it("closes tunnels at once when nothing is in flight", async () => {
    tunnel = await openTunnel(async () => ok({}));
    // Leaves an idle keep-alive socket open on the proxy
    await expect(get(agent)).resolves.toMatchObject({
      status: 200,
      connection: "keep-alive",
    });

    await app.drain();

    await expect(tunnel.closed).resolves.toMatchObject({
      code: SERVICE_RESTART_CLOSE_CODE,
    });
  });

  it("closes tunnels after the drain timeout when a request never finishes", async () => {
    const called = deferral();
    tunnel = await openTunnel(() => {
      called.resolve();
      return new Promise<never>(() => {});
    });
    void get(agent).catch(() => {});
    await called.promise;

    const { state, drained } = startDrain(app);
    await vi.advanceTimersByTimeAsync(DRAIN_TIMEOUT_MILLIS - 1);
    expect(state.done).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await expect(tunnel.closed).resolves.toMatchObject({
      code: SERVICE_RESTART_CLOSE_CODE,
    });
    await drained;
  });
});
