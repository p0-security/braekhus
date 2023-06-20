import { JSONRPCClient, JSONRPCServer, JSONRPCServerAndClient } from "json-rpc-2.0";
import { randomUUID } from "node:crypto";
import { WebSocketServer } from "ws";

/**
 * Bi-directional JSON RPC server
 */
export class JsonRpcServer {

  #serverSocket: WebSocketServer;
  #connections: Map<string, JSONRPCServerAndClient<void, void>> = new Map();

  constructor(port: number) {
    this.#serverSocket = new WebSocketServer({ port });
    this.#serverSocket.on("connection", (ws) => {
      const id = randomUUID();

      const jsonRpcServer = new JSONRPCServerAndClient(
        new JSONRPCServer(),
        new JSONRPCClient(request => {
          try {
            ws.send(JSON.stringify(request));
            return Promise.resolve();
          } catch (error) {
            return Promise.reject(error);
          }
        }),
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

  private callClients() {
    console.log("callClients called");
    for (const [id, server] of this.#connections.entries()) {
      console.log("calling client", id);
      server.request("sum", {x: 1, y: 2}).then(response => console.log("server response", response));
    }
  }
}
