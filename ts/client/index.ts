import axios from "axios";
import {
  JSONRPCClient,
  JSONRPCServer,
  JSONRPCServerAndClient,
} from "json-rpc-2.0";
import { omit } from "lodash";
import { Logger } from "pino";
import { ForwardedRequest, ForwardedResponse } from "types";
import WebSocket from "ws";

import { createLogger } from "../log";
import { deferral } from "../util/deferral";
import { jwt } from "./jwks";

const CONNECT_RETRY_INTERVAL_MILLIS = 3000;
const KEEP_ALIVE_INTERVAL_MILLIS = 5000;

/**
 * Bi-directional JSON RPC client
 */
export class JsonRpcClient {
  #jsonRpcClient = deferral<JSONRPCServerAndClient>();
  #connected = deferral<void>();
  #webSocketUrl: string;
  #httpUrl: string;
  #targetUrl: string;
  #targetHostName: string;
  #clientId: string;
  #logger: Logger;

  #webSocket?: WebSocket;
  #keepAliveTimeout?: NodeJS.Timeout;
  #retryTimeout?: NodeJS.Timeout;
  #isShutdown: boolean = false;

  constructor(
    proxyConfig: { targetUrl: string; clientId: string },
    tunnelConfig: { host: string; port: number; insecure?: boolean }
  ) {
    this.#logger = createLogger({ name: "JsonRpcClient" });
    const { targetUrl, clientId } = proxyConfig;
    this.#targetUrl = targetUrl;
    this.#targetHostName = new URL(targetUrl).hostname;
    this.#clientId = clientId;
    const { host, port, insecure } = tunnelConfig;
    this.#webSocketUrl = `ws${!insecure ? "s" : ""}://${host}:${port}`;
    this.#httpUrl = `http${!insecure ? "s" : ""}://${host}:${port}`;
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

    const keepAlive = () => {
      axios
        .request({
          baseURL: this.#httpUrl,
          url: "/live",
          method: "GET",
          validateStatus: () => true, // do not throw, we return all status codes
        })
        .then((response) => {
          this.#logger.debug({ response }, "live response");
          this.#keepAliveTimeout = setTimeout(
            keepAlive,
            KEEP_ALIVE_INTERVAL_MILLIS
          );
        });
      // client.request("live", { clientId: this.#clientId }).then((response) => {
      //   this.#logger.debug({ response }, "live response");
      //   this.#keepAliveTimeout = setTimeout(
      //     keepAlive,
      //     KEEP_ALIVE_INTERVAL_MILLIS
      //   );
      // });
    };

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
          this.#connected.resolve();
        });
      this.#keepAliveTimeout = setTimeout(
        keepAlive,
        KEEP_ALIVE_INTERVAL_MILLIS
      );
    });

    clientSocket.on("close", () => {
      this.#logger.info("connection closed");
      // Keep looking for the server after closing the connection
      if (!this.#isShutdown) {
        this.#retryTimeout = setTimeout(
          () => this.create(),
          CONNECT_RETRY_INTERVAL_MILLIS
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
      this.#logger.debug("ping");
    });

    this.#webSocket = clientSocket;

    axios.interceptors.request.use((request) => {
      this.#logger.debug({ request }, "Axios request");
      return request;
    });

    axios.interceptors.response.use((response) => {
      this.#logger.debug({ response }, "Axios response");
      return response;
    });

    client.addMethod("live", ({}) => {
      return { ok: true };
    });
    client.addMethod("call", async (request: ForwardedRequest) => {
      this.#logger.info({ request }, "forwarded request");
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
    clearTimeout(this.#keepAliveTimeout);
    clearTimeout(this.#retryTimeout);
    this.#webSocket?.close();
  }
}
