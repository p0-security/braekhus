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
import { ServerOptions, WebSocket, WebSocketServer } from "ws";

/**
 * Bi-directional JSON RPC server
 */
export class JsonRpcServer {
  #serverSocket: WebSocketServer;
  #connections: Map<string, JSONRPCServerAndClient<void, void>> = new Map();

  constructor(
    options: ServerOptions<typeof WebSocket, typeof IncomingMessage>
  ) {
    this.#serverSocket = new WebSocketServer(options);
    this.#serverSocket.on("connection", (ws) => {
      console.log(typeof ws);
      const id = randomUUID();

      const jsonRpcServer = new JSONRPCServerAndClient(
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

      jsonRpcServer.addMethod("echo", ({ text }) => ({ text }));

      ws.on("message", (data, isBinary) => {
        if (isBinary) {
          console.error("binary data not expected");
          return;
        }
        const message = data.toString("utf-8");
        console.log("server on message:", message);
        jsonRpcServer.receiveAndSend(JSON.parse(message));
      });
      ws.on("error", console.error);
      ws.on("close", () => {
        this.#connections.delete(id);
        console.log("closed connection", id);
      });

      this.#connections.set(id, jsonRpcServer);
    });

    this.#serverSocket.on("error", console.error);
    this.#serverSocket.on("close", () => {});

    setInterval(() => this.callClients(), 3000);
  }

  getWebSocketServer(): WebSocketServer {
    return this.#serverSocket;
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

  private callClients() {
    for (const [id, server] of this.#connections.entries()) {
      console.log("calling client", id);
      server
        .request("sum", { x: 1, y: 2 })
        .then((response) => console.log("server response", response));
    }
  }
}

export class JsonRpcApp {
  #app: Express;
  #httpServer: Server<typeof IncomingMessage, typeof ServerResponse>;
  #rpcServer: JsonRpcServer;

  constructor(port: number) {
    this.#app = express();
    this.#rpcServer = new JsonRpcServer({ noServer: true });

    this.#app.get("/live", (_req, res) => {
      console.log("live");
      return res.status(200).json({ message: "OK" });
    });
    this.#httpServer = this.#app.listen(port, () => {
      console.log(`JSON RPC service listening on port ${port}`);
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
}
