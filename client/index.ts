import axios from "axios";
import {
  JSONRPCClient,
  JSONRPCServer,
  JSONRPCServerAndClient,
} from "json-rpc-2.0";
import { omit } from "lodash";
import { Logger } from "pino";
import WebSocket from "ws";

import { createLogger } from "../log";
import { ForwardedRequest, ForwardedResponse } from "../types";
import { deferral } from "../util/deferral";
import { Backoff } from "./backoff";
import { jwt } from "./jwks";

/**
 * Bi-directional JSON RPC client
 */
export class JsonRpcClient {
  #jsonRpcClient = deferral<JSONRPCServerAndClient>();
  #connected = deferral<void>();
  #webSocketUrl: string;
  #targetUrl: string;
  #targetHostName: string;
  #clientId: string;
  #logger: Logger;

  #backoff?: Backoff;
  #webSocket?: WebSocket;
  #retryTimeout?: NodeJS.Timeout;
  #isShutdown: boolean = false;

  constructor(
    proxyConfig: { targetUrl: string; clientId: string },
    tunnelConfig: {
      host: string;
      port: number;
      insecure?: boolean;
      backoff?: Backoff;
    }
  ) {
    this.#logger = createLogger({ name: "JsonRpcClient" });
    const { targetUrl, clientId } = proxyConfig;
    this.#targetUrl = targetUrl;
    this.#targetHostName = new URL(targetUrl).hostname;
    this.#clientId = clientId;
    const { host, port, insecure, backoff } = tunnelConfig;
    this.#webSocketUrl = `ws${!insecure ? "s" : ""}://${host}:${port}`;
    this.#backoff = backoff;
    this.#jsonRpcClient.completeWith(this.create());
    this.#jsonRpcClient.promise.catch((error: any) =>
      this.#logger.error({ error }, "Error creating JSON RPC client")
    );
  }

  async create() {
    const token = await jwt(this.#clientId);
    const clientSocket = new WebSocket(this.#webSocketUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const client = new JSONRPCServerAndClient(
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

    clientSocket.on("error", (error) => {
      // Do not throw error. The `on("close")` handler is called, which retries the connection.
      this.#logger.warn({ error }, "websocket error");
    });

    clientSocket.on("open", () => {
      this.#logger.info("connection opened");
      // After opening the connection, send the client ID to the server
      client
        .request("setClientId", { clientId: this.#clientId })
        .then((response) => {
          this.#logger.info({ response }, "setClientId response");
          this.#backoff?.reset();
          this.#connected.resolve();
        });
    });

    clientSocket.on("close", () => {
      this.#logger.info("connection closed");
      // Keep looking for the server after closing the connection
      if (!this.#isShutdown && this.#backoff) {
        this.#retryTimeout = setTimeout(
          () => this.create(),
          this.#backoff.next()
        );
      }
    });

    clientSocket.on("message", (data, isBinary) => {
      if (isBinary) {
        this.#logger.warn("Message in binary format is not supported");
        return;
      }
      const message = data.toString("utf-8");
      client.receiveAndSend(JSON.parse(message));
    });

    clientSocket.on("ping", () => {
      // The client automatically responds to ping messages without an implementation here
      // TODO detect broken connection based on https://github.com/websockets/ws#how-to-detect-and-close-broken-connections
      this.#logger.debug("ping");
    });

    this.#webSocket = clientSocket;

    axios.interceptors.request.use((request) => {
      this.#logger.debug({ request }, "Axios request");
      return request;
    });

    axios.interceptors.response.use((response) => {
      // Do not log response object, it's lengthy and difficult to filter out the authorization header
      this.#logger.debug(
        { response: omit(response, "request") },
        "Axios response"
      );
      return response;
    });

    client.addMethod("call", async (request: ForwardedRequest) => {
      this.#logger.debug({ request }, "forwarded request");
      // The headers are modified:
      // 1. The Content-Length header may not be accurate for the forwarded request. By removing it, axios can recalculate the correct length.
      // 2. The Host header should be switched out to the host this client is targeting.
      const response = await axios({
        baseURL: this.#targetUrl,
        url: request.path,
        method: request.method,
        headers: {
          ...omit(request.headers, "content-length"),
          host: this.#targetHostName,
        },
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

    return client;
  }

  async run() {
    await this.#jsonRpcClient.promise;
  }

  async waitUntilConnected() {
    await this.#connected.promise;
  }

  shutdown() {
    this.#isShutdown = true;
    clearTimeout(this.#retryTimeout);
    this.#webSocket?.close();
  }
}
