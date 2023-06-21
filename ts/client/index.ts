import { deferral } from "./deferral";
import { jwt } from "./jwks";
import {
  JSONRPCClient,
  JSONRPCServer,
  JSONRPCServerAndClient,
} from "json-rpc-2.0";
import WebSocket from "ws";

/**
 * Bi-directional JSON RPC client
 */
export class JsonRpcClient {
  #jsonRpcClient = deferral<JSONRPCServerAndClient>();
  #url: string;

  constructor(host: string, port: number, options: { insecure?: boolean }) {
    this.#url = `ws${!options.insecure ? "s" : ""}://${host}:${port}`;
    this.#jsonRpcClient.completeWith(this.create());
    this.#jsonRpcClient.promise.catch((error: any) => console.error(error));
  }

  async create() {
    const token = await jwt();
    const clientSocket = new WebSocket(this.#url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const jsonRpcClient = new JSONRPCServerAndClient(
      new JSONRPCServer(),
      new JSONRPCClient((request) => {
        try {
          clientSocket.send(JSON.stringify(request));
          return Promise.resolve();
        } catch (error) {
          return Promise.reject(error);
        }
      })
    );

    clientSocket.on("error", console.error);

    clientSocket.on("open", () => {
      jsonRpcClient
        .request("echo", { text: "Hello, World!" })
        .then((response) => console.log("client received", response));
    });

    clientSocket.on("message", (data, isBinary) => {
      if (isBinary) {
        console.error("Unexpected binary data");
        return;
      }
      const message = data.toString("utf-8");
      jsonRpcClient.receiveAndSend(JSON.parse(message));
    });

    return jsonRpcClient;
  }

  async run() {
    const client = await this.#jsonRpcClient.promise;
    client.addMethod("sum", ({ x, y }) => {
      console.log("sum method called");
      return { result: x + y };
    });
  }
}
