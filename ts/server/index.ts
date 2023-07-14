import express, { Express } from "express";
import { IncomingMessage, Server, ServerResponse } from "http";
import {
  JSONRPCClient,
  JSONRPCServer,
  JSONRPCServerAndClient,
} from "json-rpc-2.0";
import { randomUUID } from "node:crypto";
import { Duplex } from "node:stream";
import { Logger } from "pino";
import audit from "pino-http";
import { ServerOptions, WebSocket, WebSocketServer } from "ws";

import { RetryOptions, retryWithBackoff } from "../client/backoff";
import { createLogger } from "../log";
import { ForwardedResponse } from "../types";
import { deferral } from "../util/deferral";
import { validateAuth } from "./auth";
import { ChannelNotFoundError } from "./error";
import { httpProxyApp } from "./proxy";
import { httpError } from "./util";

const logger = createLogger({ name: "server" });

type ClientId = string;
type ChannelId = string;

type AppContext = {
  rpcPort: number;
  proxyPort: number;
};

export type InitContext = {
  clientIds: Map<ChannelId, ClientId>;
};

export type App = {
  expressApp: Express;
  expressHttpServer: Server<typeof IncomingMessage, typeof ServerResponse>;
  jsonRpcApp: JsonRpcApp;
};

export const runApp = (appParams: {
  appContext: AppContext;
  initContext?: InitContext;
  retryOptions?: RetryOptions;
}): App => {
  const { appContext, initContext, retryOptions } = appParams;
  const { rpcPort, proxyPort } = appContext;
  const rpcHttpApp = express();

  // Log all requests
  rpcHttpApp.use(
    audit({
      logger,
      customLogLevel: (_req, res) => {
        // Note that _req is undefined :[
        return res.req.url === "/live" ? "debug" : "info";
      },
    })
  );

  rpcHttpApp.get("/live", (_req, res) => {
    return res.status(200).json({ message: "OK" });
  });

  const rpcHttpServer = rpcHttpApp.listen(rpcPort, () => {
    logger.info(`HTTP JSON RPC service listening on port ${rpcPort}`);
  });
  const jsonRpcApp = new JsonRpcApp(rpcHttpServer, initContext);
  const expressApp = httpProxyApp(jsonRpcApp.getRpcServer(), retryOptions);
  const expressHttpServer = expressApp.listen(proxyPort, () => {
    logger.info(`HTTP Proxy app listening on port ${proxyPort}`);
  });
  return { expressApp, expressHttpServer, jsonRpcApp };
};

/**
 * Bi-directional JSON RPC server
 */
export class JsonRpcServer {
  #serverSocket: WebSocketServer;
  #channels: Map<ChannelId, JSONRPCServerAndClient<void, void>> = new Map();
  #logger: Logger;
  #intervalTimer: NodeJS.Timer;

  constructor(
    options: ServerOptions<typeof WebSocket, typeof IncomingMessage>,
    onChannelConnection: (
      channelId: ChannelId,
      channel: JSONRPCServerAndClient
    ) => void,
    onChannelClose: (channelId: ChannelId) => void
  ) {
    this.#logger = createLogger({ name: "JsonRpcServer" });
    this.#serverSocket = new WebSocketServer(options);
    this.#serverSocket.on("connection", (ws) => {
      const channelId = randomUUID();

      const channel = new JSONRPCServerAndClient(
        new JSONRPCServer(),
        new JSONRPCClient((request) => {
          try {
            ws.send(JSON.stringify(request));
            return Promise.resolve();
          } catch (error) {
            return Promise.reject(error);
          }
        })
      );

      onChannelConnection(channelId, channel);

      ws.on("message", (data, isBinary) => {
        if (isBinary) {
          this.#logger.warn("Message in binary format is not supported");
          return;
        }
        const message = data.toString("utf-8");
        channel.receiveAndSend(JSON.parse(message));
      });
      ws.on("pong", () => this.#logger.debug("pong"));
      ws.on("error", (err) => this.#logger.error(err));
      ws.on("close", () => {
        onChannelClose(channelId);
        this.#channels.delete(channelId);
        this.#logger.info({ channelId }, "Channel closed");
      });

      this.#channels.set(channelId, channel);
    });

    this.#serverSocket.on("error", (err) => this.#logger.error(err));
    this.#serverSocket.on("close", () => {});

    this.#intervalTimer = setInterval(() => this.healthCheck(), 5000);
  }

  handleUpgrade(
    request: InstanceType<typeof IncomingMessage>,
    socket: Duplex,
    head: Buffer
  ) {
    this.#serverSocket.handleUpgrade(request, socket, head, (socket) => {
      this.#serverSocket.emit("connection", socket, request);
    });
  }

  async call(
    channelId: ChannelId,
    method: string,
    request: any
  ): Promise<ForwardedResponse> {
    const requestId = randomUUID();
    this.#logger.debug(
      { requestId, channelId, method, request },
      "RPC request"
    );
    const channel = this.#channels.get(channelId);
    if (!channel) {
      throw new ChannelNotFoundError(`Channel not found: ${channelId}`);
    }
    const deferred = deferral<any>();
    channel.request(method, request).then(
      (response) => {
        this.#logger.debug(
          { requestId, channelId, method, response },
          "RPC response"
        );
        deferred.resolve(response);
      },
      (reason) => {
        this.#logger.error(
          { requestId, channelId, method, reason },
          "RPC response"
        );
        deferred.reject(reason);
      }
    );
    return deferred.promise;
  }

  shutdown() {
    clearInterval(this.#intervalTimer);
    this.#serverSocket.close();
  }

  async broadcast(method: string, request: any) {
    const promises = [...this.#channels.keys()].map((channelId) =>
      this.call(channelId, method, request)
    );
    return Promise.allSettled(promises);
  }

  private async healthCheck() {
    this.#serverSocket.clients.forEach((ws) => {
      // TODO detect broken connection based on https://github.com/websockets/ws#how-to-detect-and-close-broken-connections
      ws.ping();
    });
  }
}

export class RemoteClientRpcServer extends JsonRpcServer {
  // When we call clients over the websocket tunnel we look up channelIds by the clusterId, and clusterId is set by clients
  #channelIds: Map<ClientId, ChannelId> = new Map();
  // When a new clusterId is set we have to find if there is an existing mapping for that channelId using this reverse mapping
  #clientIds: Map<ChannelId, ClientId> = new Map();
  #logger: Logger;

  constructor(
    options: ServerOptions<typeof WebSocket, typeof IncomingMessage>,
    initContext?: InitContext
  ) {
    super(
      options,
      (channelId, channel) => this.onChannelConnection(channelId, channel),
      (channelId) => this.onChannelClose(channelId)
    );
    this.#logger = createLogger({ name: "ClusterRpcServer" });
    if (initContext) {
      const { clientIds } = initContext;
      for (const [channelId, clientId] of clientIds) {
        this.addChannel(channelId, clientId);
      }
    }
  }

  private removeChannel(channelId: ChannelId) {
    const clientId = this.#clientIds.get(channelId);
    this.#clientIds.delete(channelId);
    if (clientId) {
      this.#channelIds.delete(clientId);
    }
  }

  private addChannel(channelId: ChannelId, clientId: ClientId) {
    // Remove existing mapping
    this.removeChannel(channelId);
    // Add new mapping
    this.#channelIds.set(clientId, channelId);
    this.#clientIds.set(channelId, clientId);
  }

  onChannelConnection(channelId: ChannelId, channel: JSONRPCServerAndClient) {
    channel.addMethod("setClientId", ({ clientId }) => {
      this.#logger.info({ channelId, clientId }, "Setting client ID");
      this.addChannel(channelId, clientId);
      return { ok: true };
    });
  }

  onChannelClose(channelId: ChannelId) {
    this.removeChannel(channelId);
  }

  async #callClient(method: string, request: any, clientId: ClientId) {
    const channelId = this.#channelIds.get(clientId);
    if (!channelId) {
      throw new Error(`Client not found: ${clientId}`);
    }
    this.#logger.trace({ channelId, method, request }, "Calling");
    return this.call(channelId, method, request);
  }

  async callClientWithRetry(
    method: string,
    request: any,
    clientId: ClientId,
    retryOptions?: RetryOptions
  ) {
    if (retryOptions) {
      return await retryWithBackoff(retryOptions, () =>
        this.#callClient(method, request, clientId)
      );
    }
    return this.#callClient(method, request, clientId);
  }
}

export class JsonRpcApp {
  #httpServer: Server<typeof IncomingMessage, typeof ServerResponse>;
  #rpcServer: RemoteClientRpcServer;
  #logger: Logger;

  constructor(
    httpServer: Server<typeof IncomingMessage, typeof ServerResponse>,
    initContext?: InitContext
  ) {
    this.#logger = createLogger({ name: "JsonRpcApp" });
    this.#httpServer = httpServer;
    this.#rpcServer = new RemoteClientRpcServer(
      { noServer: true },
      initContext
    );

    this.#httpServer.on("upgrade", (request, socket, head) => {
      (async () => {
        await validateAuth(request.headers.authorization);
        this.#rpcServer.handleUpgrade(request, socket, head);
      })().catch((error: any) => {
        this.#logger.error({ error }, "Error upgrading connection");
        const body = JSON.stringify({ error }, undefined, 2);
        const code = error.code ?? 500;
        const reason = error.reason ?? "Internal Server Error";
        socket.write(httpError(code, reason, body));
        socket.destroy();
      });
    });
  }

  getRpcServer() {
    return this.#rpcServer;
  }

  shutdown() {
    this.#rpcServer.shutdown();
    this.#httpServer.close();
  }
}
