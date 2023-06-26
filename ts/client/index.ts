import { deferral } from "../util/deferral";
import { jwt } from "./jwks";
import axios from "axios";
import {
  JSONRPCClient,
  JSONRPCServer,
  JSONRPCServerAndClient,
} from "json-rpc-2.0";
import path from "path";
import pinoLogger, { Logger } from "pino";
import { ForwardedRequest, ForwardedResponse } from "types";
import WebSocket from "ws";

/**
 * Bi-directional JSON RPC client
 */
export class JsonRpcClient {
  #jsonRpcClient = deferral<JSONRPCServerAndClient>();
  #webSocketUrl: string;
  #targetUrl: string;
  #logger: Logger;

  constructor(
    targetUrl: string,
    tunnelConfig: { host: string; port: number; insecure?: boolean }
  ) {
    this.#logger = pinoLogger({ name: "JsonRpcClient" });
    this.#targetUrl = targetUrl;
    const { host, port, insecure } = tunnelConfig;
    this.#webSocketUrl = `ws${!insecure ? "s" : ""}://${host}:${port}`;
    this.#jsonRpcClient.completeWith(this.create());
    this.#jsonRpcClient.promise.catch((error: any) =>
      this.#logger.error({ error }, "Error creating JSON RPC client")
    );
  }

  async create() {
    const token = await jwt();
    const clientSocket = new WebSocket(this.#webSocketUrl, {
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

    clientSocket.on("error", (err) => this.#logger.error(err));

    clientSocket.on("open", () => {
      // After opening a connection, send the cluster ID to the server
      jsonRpcClient
        .request("setClientId", { clusterId: "myClusterId" })
        .then((response) =>
          this.#logger.info({ response }, "setClientId response")
        );
    });

    clientSocket.on("message", (data, isBinary) => {
      if (isBinary) {
        this.#logger.warn("Message in binary format is not supported");
        return;
      }
      const message = data.toString("utf-8");
      jsonRpcClient.receiveAndSend(JSON.parse(message));
    });

    return jsonRpcClient;
  }

  async run() {
    const client = await this.#jsonRpcClient.promise;
    client.addMethod("live", ({}) => {
      return { ok: true };
    });
    client.addMethod("call", async (request: ForwardedRequest) => {
      this.#logger.info({ request }, "forwarded request");
      const response = await axios({
        baseURL: this.#targetUrl,
        url: request.path,
        method: request.method,
        headers: request.headers,
        params: request.params,
        data: request.data,
        validateStatus: () => true, // do not throw, we return all status codes
      });
      return {
        headers: response.headers,
        status: response.status,
        statusText: response.statusText,
        data: response.data,
      } as ForwardedResponse;
    });
  }
}
