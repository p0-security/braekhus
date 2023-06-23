import { deferral } from "../util/deferral";
import { validateAuth } from "./auth";
import { httpError } from "./util";
import express, { Express } from "express";
import { IncomingMessage, Server, ServerResponse } from "http";
import {
  JSONRPCClient,
  JSONRPCServer,
  JSONRPCServerAndClient,
} from "json-rpc-2.0";
import { randomUUID } from "node:crypto";
import { Duplex } from "node:stream";
import pinoLogger, { Logger } from "pino";
import audit from "pino-http";
import { ServerOptions, WebSocket, WebSocketServer } from "ws";

type ClusterId = string;
type ChannelId = string;

/**
 * Bi-directional JSON RPC server
 */
export class JsonRpcServer {
  #serverSocket: WebSocketServer;
  #channels: Map<ChannelId, JSONRPCServerAndClient<void, void>> = new Map();
  #logger: Logger;

  constructor(
    options: ServerOptions<typeof WebSocket, typeof IncomingMessage>,
    port: number,
    onChannelConnection: (
      channelId: ChannelId,
      channel: JSONRPCServerAndClient
    ) => void,
    onChannelClose: (channelId: ChannelId) => void
  ) {
    this.#logger = pinoLogger({ name: "JsonRpcServer", port });
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

    setInterval(() => this.healthCheck(), 3000);
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

  async call(channelId: ChannelId, method: string, request: any) {
    const requestId = randomUUID();
    const log = (obj: unknown, msg?: string, ...args: any[]) =>
      method === "live"
        ? this.#logger.debug(obj, msg, args)
        : this.#logger.info(obj, msg, args);
    log({ requestId, channelId, method, request }, "RPC request");
    const channel = this.#channels.get(channelId);
    if (!channel) {
      throw new Error(`Channel not found: ${channelId}`);
    }
    const deferred = deferral<any>();
    channel.request(method, request).then(
      (response) => {
        log({ requestId, channelId, method, response }, "RPC response");
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

  async broadcast(method: string, request: any) {
    const promises = [...this.#channels.keys()].map((channelId) =>
      this.call(channelId, method, request)
    );
    return Promise.allSettled(promises);
  }

  private async healthCheck() {
    // TODO do something if the health check fails for some channels
    await this.broadcast("live", {});
  }
}

export class PermissionerRpcServer extends JsonRpcServer {
  // When we call clients over the websocket tunnel we look up channelIds by the clusterId, and clusterId is set by clients
  #channelIds: Map<ClusterId, ChannelId> = new Map();
  // When a new clusterId is set we have to find if there is an existing mapping for that channelId using this reverse mapping
  #clusterIds: Map<ChannelId, ClusterId> = new Map();
  #logger: Logger;

  constructor(
    options: ServerOptions<typeof WebSocket, typeof IncomingMessage>,
    port: number
  ) {
    super(
      options,
      port,
      (channelId, channel) => this.onChannelConnection(channelId, channel),
      (channelId) => this.onChannelClose(channelId)
    );
    this.#logger = pinoLogger({ name: "PermissionerRpcServer", port });
  }

  private removeChannel(channelId: ChannelId) {
    const clusterId = this.#clusterIds.get(channelId);
    this.#clusterIds.delete(channelId);
    if (clusterId) {
      this.#channelIds.delete(clusterId);
    }
  }

  onChannelConnection(channelId: ChannelId, channel: JSONRPCServerAndClient) {
    channel.addMethod("setClusterId", ({ clusterId }) => {
      this.#logger.info({ channelId, clusterId }, "Setting cluster ID");
      // Remove existing mapping
      this.removeChannel(channelId);
      // Add new mapping
      this.#channelIds.set(clusterId, channelId);
      this.#clusterIds.set(channelId, clusterId);
      return { ok: true };
    });
  }

  onChannelClose(channelId: ChannelId) {
    this.removeChannel(channelId);
  }

  async callCluster(method: string, request: any, clusterId: ClusterId) {
    const channelId = this.#channelIds.get(clusterId);
    if (!channelId) {
      return Promise.reject(new Error(`Cluster not found: ${clusterId}`));
    }
    return this.call(channelId, method, request);
  }
}

export class JsonRpcApp {
  #app: Express;
  #httpServer: Server<typeof IncomingMessage, typeof ServerResponse>;
  #rpcServer: PermissionerRpcServer;
  #logger: Logger;

  constructor(port: number) {
    this.#app = express();
    this.#rpcServer = new PermissionerRpcServer({ noServer: true }, port);
    this.#logger = pinoLogger({ name: "JsonRpcApp", port });

    this.middleware();
    this.routes();

    this.#httpServer = this.#app.listen(port, () => {
      this.#logger.info(`JSON RPC service listening on port ${port}`);
    });

    this.#httpServer.on("upgrade", (request, socket, head) => {
      (async () => {
        await validateAuth(request.headers.authorization);
        this.#rpcServer.handleUpgrade(request, socket, head);
      })().catch((error: any) => {
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

  private middleware() {
    // Log all requests
    this.#app.use(
      audit({
        logger: this.#logger,
        customLogLevel: (_req, res) => {
          // Note that _req is undefined :[
          return res.req.url === "/live" ? "debug" : "info";
        },
      })
    );
  }

  private routes() {
    this.#app.get("/live", (_req, res) => {
      return res.status(200).json({ message: "OK" });
    });
  }
}
