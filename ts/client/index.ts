import { JSONRPCClient, JSONRPCServer, JSONRPCServerAndClient } from "json-rpc-2.0";
import WebSocket from "ws";

/**
 * Bi-directional JSON RPC client
 */
export class JsonRpcClient {

  #clientSocket: WebSocket;
  
  constructor(host: string, port: number) {
    this.#clientSocket = new WebSocket(`ws://${host}:${port}`);
    const jsonRpcClient = new JSONRPCServerAndClient(
      new JSONRPCServer(),
      new JSONRPCClient(request => {
        try {
          this.#clientSocket.send(JSON.stringify(request));
          return Promise.resolve();
        } catch (error) {
          return Promise.reject(error);
        }
      }),
    );

    this.#clientSocket.on("error", console.error);

    this.#clientSocket.on("open", () => {
      jsonRpcClient.request("echo", { text: "Hello, World!" }).then(response => console.log("client received", response));
    });

    this.#clientSocket.on("message", (data, isBinary) => {
      if (isBinary) {
        console.error("Unexpected binary data");
        return;
      }
      const message = data.toString("utf-8");
      jsonRpcClient.receiveAndSend(JSON.parse(message))
    });

    jsonRpcClient.addMethod("sum", ({ x, y }) => {
      console.log("sum method called");
      return {result: x + y};
    });
  }
}