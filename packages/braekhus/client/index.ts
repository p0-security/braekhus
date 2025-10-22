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

/**
 * Bi-directional JSON RPC client
 */
export class JsonRpcClient {
  #jsonRpcClient?: JSONRPCServerAndClient;
  #connected = deferral<void>();
  #webSocketUrl: string;
  #targetUrl: string;
  #targetHostName: string;
  #clientId: string;
  #jwkPath: string;
  #logger: Logger;

  #backoff?: Backoff;
  #webSocket?: WebSocket;
  #retryTimeout?: NodeJS.Timeout;
  #isShutdown: boolean = false;
  #reconnectAttempts: number = 0;

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

    // Initiate the first connection
    this.#initiateConnection();

    axios.interceptors.request.use((request) => {
      this.#logger.debug({ request }, "Axios request");
      return request;
    });

    axios.interceptors.response.use((response) => {
      this.#logger.debug({ response }, "Axios response");
      return response;
    });
  }

  /**
   * Initiates a connection attempt with proper error handling
   */
  #initiateConnection() {
    this.#reconnectAttempts++;
    this.#logger.info(
      { attempt: this.#reconnectAttempts },
      "Initiating connection attempt"
    );

    this.create().catch((error) => {
      this.#logger.error(
        { error, attempt: this.#reconnectAttempts },
        "Failed to create connection, will retry"
      );
      // Schedule reconnection attempt
      this.#scheduleReconnect();
    });
  }

  /**
   * Schedules a reconnection attempt using backoff strategy
   */
  #scheduleReconnect() {
    if (this.#isShutdown) {
      this.#logger.info("Shutdown in progress, not scheduling reconnect");
      return;
    }

    if (!this.#backoff) {
      this.#logger.warn(
        "No backoff configured, reconnection will not be attempted"
      );
      return;
    }

    const delay = this.#backoff.next();
    this.#logger.info(
      { delayMs: delay, attempt: this.#reconnectAttempts + 1 },
      "Scheduling reconnection attempt"
    );

    this.#retryTimeout = setTimeout(() => {
      this.#initiateConnection();
    }, delay);
  }

  /**
   * Resets connection state for reconnection
   */
  #resetConnectionState() {
    // Reset the connected deferral so waitUntilConnected() works correctly
    if (this.#connected.isResolved()) {
      this.#logger.debug("Resetting connection state for reconnection");
      this.#connected = deferral<void>();
    }
  }

  async create() {
    let token: string;
    try {
      token = await jwt(this.#jwkPath, this.#clientId);
    } catch (error) {
      this.#logger.error({ error }, "Failed to generate JWT token");
      throw error;
    }

    const clientSocket = new WebSocket(this.#webSocketUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });

    // Update the socket reference immediately
    this.#webSocket = clientSocket;

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
      this.#logger.warn(
        { error, attempt: this.#reconnectAttempts },
        "websocket error"
      );
    });

    clientSocket.on("open", () => {
      this.#logger.info(
        { attempt: this.#reconnectAttempts },
        "connection opened"
      );
      // After opening the connection, send the client ID to the server
      Promise.resolve(
        client.request("setClientId", { clientId: this.#clientId })
      )
        .then((response) => {
          this.#logger.info({ response }, "setClientId response");
          this.#backoff?.reset();
          this.#reconnectAttempts = 0;
          this.#connected.resolve();
        })
        .catch((error) => {
          this.#logger.error(
            { error },
            "Failed to send setClientId, closing connection"
          );
          clientSocket.close();
        });
    });

    clientSocket.on("close", () => {
      this.#logger.info(
        { attempt: this.#reconnectAttempts },
        "connection closed"
      );
      // Reset connection state for reconnection
      this.#resetConnectionState();
      // Schedule reconnection attempt
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
      // TODO detect broken connection based on https://github.com/websockets/ws#how-to-detect-and-close-broken-connections
      this.#logger.debug("ping");
    });

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

    // Update the JSON-RPC client reference
    this.#jsonRpcClient = client;

    return client;
  }

  async run() {
    // Keep the process alive by waiting on the connected promise
    // This will never resolve if connection keeps failing, which is intentional
    await this.#connected.promise;
  }

  async waitUntilConnected() {
    await this.#connected.promise;
  }

  /**
   * Returns the current JSON-RPC client instance
   * Throws if no client is available (not yet connected or connection failed)
   */
  getClient(): JSONRPCServerAndClient {
    if (!this.#jsonRpcClient) {
      throw new Error(
        "JSON-RPC client not available - connection not established"
      );
    }
    return this.#jsonRpcClient;
  }

  shutdown() {
    this.#isShutdown = true;
    clearTimeout(this.#retryTimeout);
    this.#webSocket?.close();
  }
}
