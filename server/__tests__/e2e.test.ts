import { Server } from "http";
import request from "supertest";

import { App, InitContext, runApp } from "../";
// TODO replace supertest with axios requests
import { JsonRpcClient } from "../../client";
import { Backoff } from "../../client/backoff";
import { testHttpServer } from "../testing/testExpressApp";

const SERVER_RPC_PORT = 18080;
const SERVER_PROXY_PORT = 18081;
const TARGET_PORT = 18082;

type Client = {
  jsonRpcClient: JsonRpcClient;
  httpServer: Server;
};

const runServer = (initContext?: InitContext) => {
  return runApp({
    appContext: { rpcPort: SERVER_RPC_PORT, proxyPort: SERVER_PROXY_PORT },
    initContext,
  });
};

const runClient = async (waitUntilConnected?: boolean): Promise<Client> => {
  const httpServer = testHttpServer(TARGET_PORT);
  const jsonRpcClient = new JsonRpcClient(
    {
      targetUrl: `http://localhost:${TARGET_PORT}`,
      clientId: "testClientId",
      jwkPath: ".",
    },
    {
      host: "localhost",
      port: SERVER_RPC_PORT,
      insecure: true,
      backoff: new Backoff(500, 500),
    }
  );
  await jsonRpcClient.run();
  if (waitUntilConnected) {
    await jsonRpcClient.waitUntilConnected();
  }
  return { jsonRpcClient, httpServer };
};

export const sleep = (
  millis: number
): Promise<void> & { cancel: () => void } => {
  let timeout: NodeJS.Timeout;
  const promise = new Promise<void>((resolve) => {
    timeout = setTimeout(resolve, millis);
  });
  const cancel = () => clearTimeout(timeout);
  return Object.assign(promise, { cancel });
};

/** Runs end-to-end tests. The server starts up first. */
describe("Proxy server starts up first", () => {
  let server: App;

  beforeAll(() => {
    const clientIds = new Map([["testChannelId", "testClientId"]]);
    server = runServer({ clientIds });
  });

  afterAll(() => {
    server?.expressHttpServer?.close();
    server?.jsonRpcApp?.shutdown();
  });

  describe("when no client is connected to the Json RPC server", () => {
    it("responds 502 when client ID is valid", async () => {
      // Even though the client ID is valid, there is no client connected with with that channel ID
      await expect(
        request(server.expressApp).get("/client/testClientId")
      ).resolves.toMatchObject(
        expect.objectContaining({
          status: 502,
          text: '{"error":{"type":"channel_not_found"},"message":"Error: Channel not found: testChannelId"}',
        })
      );
    });

    it("responds 502 when client ID is invalid", async () => {
      await expect(
        request(server.expressApp).get("/client/noSuchClientId")
      ).resolves.toMatchObject(
        expect.objectContaining({
          status: 502,
          text: '{"error":{},"message":"Error: Client not found: noSuchClientId"}',
        })
      );
    });
  });

  describe("when client is connected", () => {
    let client: Client;

    beforeAll(async () => {
      client = await runClient();
      await client.jsonRpcClient.waitUntilConnected();
    });

    afterAll(() => {
      client?.jsonRpcClient?.shutdown();
      client?.httpServer?.close();
    });

    it.each([[""], ["/"], ["?q=what"], ["/?q=what"]])(
      "returns 200 if root path exists in target, with suffix '%s'",
      async (suffix) => {
        await expect(
          request(server.expressApp).get(`/client/testClientId${suffix}`)
        ).resolves.toMatchObject(
          expect.objectContaining({
            status: 200,
            text: "root",
          })
        );
      }
    );

    it("returns 200 if path exists in target", async () => {
      await expect(
        request(server.expressApp).get("/client/testClientId/happy/path")
      ).resolves.toMatchObject(
        expect.objectContaining({
          status: 200,
          text: "hello",
        })
      );
    });

    it("returns 404 if path does not exists in target", async () => {
      await expect(
        request(server.expressApp).get("/client/testClientId/unhappy/path")
      ).resolves.toMatchObject(
        expect.objectContaining({
          status: 404,
        })
      );
    });
  });
});

describe("Client starts up first", () => {
  let client: Client;
  let server: App;

  afterAll(() => {
    client?.jsonRpcClient?.shutdown();
    client?.httpServer?.close();
    server?.expressHttpServer?.close();
    server?.jsonRpcApp?.shutdown();
  });

  it("successfully retries to connect and succeeds once the proxy server is available", async () => {
    // run the client
    client = await runClient(false);
    await sleep(1000); // client should not fail
    // run the server and wait until client is connected
    server = runServer();
    await client.jsonRpcClient.waitUntilConnected();
    // stop the server
    server?.expressHttpServer?.close();
    server?.jsonRpcApp?.shutdown();
    // wait; client should not fail while server is closed
    await sleep(2000);
    // server runs again, client successfully reconnects
    server = runServer();
    await client.jsonRpcClient.waitUntilConnected();
  }, 15000);
});
