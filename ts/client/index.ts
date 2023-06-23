import { K8sClient } from "../k8s/client";
import { Create, Delete, Patch, Read, Replace } from "../types";
import { deferral } from "../util/deferral";
import { jwt } from "./jwks";
import { V1ConfigMap, V1Role, V1RoleBinding } from "@kubernetes/client-node";
import {
  JSONRPCClient,
  JSONRPCServer,
  JSONRPCServerAndClient,
} from "json-rpc-2.0";
import pinoLogger, { Logger } from "pino";
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

    const k8s = new K8sClient();
    // Role
    client.addMethod("readRole", async (request: Read) => {
      return await k8s.readRole(request);
    });
    client.addMethod("createRole", async (request: Create<V1Role>) => {
      return await k8s.createRole(request);
    });
    client.addMethod("deleteRole", async (request: Delete) => {
      return await k8s.deleteRole(request);
    });
    // RoleBinding
    client.addMethod("readRoleBinding", async (request: Read) => {
      return await k8s.readRoleBinding(request);
    });
    client.addMethod(
      "createRoleBinding",
      async (request: Create<V1RoleBinding>) => {
        return await k8s.createRoleBinding(request);
      }
    );
    client.addMethod("deleteRoleBinding", async (request: Delete) => {
      return await k8s.deleteRoleBinding(request);
    });
    // ConfigMap
    client.addMethod(
      "createConfigMap",
      async (request: Create<V1ConfigMap>) => {
        return await k8s.createConfigMap(request);
      }
    );
    client.addMethod(
      "replaceConfigMap",
      async (request: Replace<V1ConfigMap>) => {
        return await k8s.replaceConfigMap(request);
      }
    );
    client.addMethod("patchConfigMap", async (request: Patch<V1ConfigMap>) => {
      return await k8s.patchConfigMap(request);
    });
    client.addMethod("deleteConfigMap", async (request: Delete) => {
      return await k8s.deleteConfigMap(request);
    });
  }
}
