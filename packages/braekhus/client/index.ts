import axios from "axios";
import {
  JSONRPCClient,
  JSONRPCServer,
  JSONRPCServerAndClient,
} from "json-rpc-2.0";
import { omit } from "lodash-es";
import { Logger } from "pino";
import WebSocket from "ws";

import { DEFAULT_FORWARDED_REQUEST_TIMEOUT_MILLIS } from "../common/constants.js";
import { createLogger } from "../log/index.js";
import {
  ForwardedRequest,
  ForwardedResponse,
  JQ_HEADER,
} from "../types/index.js";
import { deferral } from "../util/deferral.js";
import { Backoff } from "./backoff.js";
import { jqTransform } from "./filter.js";
import { jwt } from "./jwks.js";

const PING_TIMEOUT_MS = 30000;

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
  #jwkPath: string;
  #logger: Logger;

  #backoff?: Backoff;
  #webSocket?: WebSocket;
  #pingTimeout?: NodeJS.Timeout;
  #retryTimeout?: NodeJS.Timeout;
  #isShutdown: boolean = false;

  constructor(
    proxyConfig: { targetUrl: string; clientId: string; jwkPath: string },
    tunnelConfig: {
      host: string;
      port: number;
      insecure?: boolean;
      backoff?: Backoff;
    }
  ) {
    this.#logger = createLogger({ name: "JsonRpcClient" });
    const { targetUrl, clientId, jwkPath } = proxyConfig;
    this.#targetUrl = targetUrl;
    this.#targetHostName = new URL(targetUrl).hostname;
    this.#clientId = clientId;
    this.#jwkPath = jwkPath;
    const { host, port, insecure, backoff } = tunnelConfig;
    this.#webSocketUrl = `ws${!insecure ? "s" : ""}://${host}:${port}`;
    this.#backoff = backoff;
    this.#jsonRpcClient.completeWith(this.create());
    this.#jsonRpcClient.promise.catch((error: any) =>
      this.#logger.error({ error }, "Error creating JSON RPC client")
    );

    axios.interceptors.request.use((request) => {
      this.#logger.debug({ request }, "Axios request");
      return request;
    });

    axios.interceptors.response.use((response) => {
      this.#logger.debug({ response }, "Axios response");
      return response;
    });
  }

  #scheduleReconnect() {
    // Reset the connected deferral so waitUntilConnected() works for reconnection
    if (this.#connected.isCompleted()) {
      this.#connected = deferral<void>();
    }

    if (!this.#isShutdown && this.#backoff) {
      this.#retryTimeout = setTimeout(
        () => this.create(),
        this.#backoff.next()
      );
    }
  }

  #resetPingTimeout() {
    clearTimeout(this.#pingTimeout);
    // Use `WebSocket#terminate()`, which immediately destroys the connection,
    // instead of `WebSocket#close()`, which waits for the close timer.
    // Close handler will retry connection
    this.#pingTimeout = setTimeout(() => {
      this.#logger.warn("Ping timeout - terminating connection");
      this.#webSocket?.terminate();
    }, PING_TIMEOUT_MS);
  }
  async create() {
    let token: string;
    let clientSocket: WebSocket;

    try {
      token = await jwt(this.#jwkPath, this.#clientId);
      clientSocket = new WebSocket(this.#webSocketUrl, {
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (error) {
      this.#logger.error({ error }, "Failed to create WebSocket connection");
      this.#scheduleReconnect();
      throw error;
    }

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
      // Start ping timeout
      this.#resetPingTimeout();
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
      this.#scheduleReconnect();
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
      this.#logger.debug("ping");
      this.#resetPingTimeout();
    });

    this.#webSocket = clientSocket;

    client.addMethod("call", async (request: ForwardedRequest) => {
      this.#logger.debug(
        {
          request: {
            ...request,
            headers: omit(request.headers, "authorization"),
          },
        },
        "forwarded request"
      );
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
        timeout:
          request.options?.timeoutMillis ||
          DEFAULT_FORWARDED_REQUEST_TIMEOUT_MILLIS,
      });
      const jpSelectHeader = request.headers[JQ_HEADER];
      this.#logger.debug({ response }, "forwarded response before filters");
      const data = await jqTransform(response.data, jpSelectHeader);
      this.#logger.debug(
        { response: data },
        "forwarded response data after filters"
      );
      return {
        headers: response.headers,
        status: response.status,
        statusText: response.statusText,
        data,
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
