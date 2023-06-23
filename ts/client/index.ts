import { deferral } from "../util/deferral";
import { jwt } from "./jwks";
import {
  JSONRPCClient,
  JSONRPCServer,
  JSONRPCServerAndClient,
} from "json-rpc-2.0";
import pinoLogger, { Logger } from "pino";
import { Permission } from "types";
import WebSocket from "ws";

/**
 * Bi-directional JSON RPC client
 */
export class JsonRpcClient {
  #jsonRpcClient = deferral<JSONRPCServerAndClient>();
  #url: string;
  #logger: Logger;

  constructor(host: string, port: number, options: { insecure?: boolean }) {
    this.#logger = pinoLogger({ name: "JsonRpcClient" });
    this.#url = `ws${!options.insecure ? "s" : ""}://${host}:${port}`;
    this.#jsonRpcClient.completeWith(this.create());
    this.#jsonRpcClient.promise.catch((error: any) =>
      this.#logger.error({ error }, "Error creating JSON RPC client")
    );
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

    clientSocket.on("error", (err) => this.#logger.error(err));

    clientSocket.on("open", () => {
      // After opening a connection, send the cluster ID to the server
      jsonRpcClient
        .request("setClusterId", { clusterId: "myClusterId" })
        .then((response) =>
          this.#logger.info({ response }, "setClusterId response")
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
    client.addMethod("grant", (permission: Permission) => {
      // TODO: Grant permission in Kubernetes cluster that this client is connected to
      this.#logger.info({ permission }, "grant");
      return { ok: true };
    });
    client.addMethod("revoke", (permission: Permission) => {
      // TODO: Revoke permission in Kubernetes cluster that this client is connected to
      this.#logger.info({ permission }, "revoke");
      return { ok: true };
    });
  }
}
