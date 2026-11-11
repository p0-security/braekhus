import type { Server } from "node:http";
import { createServer } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { WebSocket } from "ws";
import { WebSocketServer } from "ws";

import { JQ_HEADER } from "../../types/index.ts";
import { JsonRpcClient } from "../index.ts";

const WS_PORT = 18120;
const TARGET_PORT = 18121;

// The filter P0 sends in the JQ header with every Kubernetes list request. The
// client now fails a request whose filter cannot be applied, so this exact
// program must work on real list responses, or every list call would fail.
const KUBERNETES_LIST_FILTER =
  "{ kind: .kind, metadata: .metadata, apiVersion: .apiVersion, items: [.items[] | { metadata: { name: .metadata.name, namespace: .metadata.namespace } }] }";

const nextMessage = (ws: WebSocket) =>
  new Promise<any>((resolve) =>
    ws.once("message", (data) => resolve(JSON.parse(data.toString())))
  );

// A namespaced list as the API server returns it for a page of a larger list:
// the items carry far more than the filter keeps, and the list metadata holds
// the continue token.
const POD_LIST = {
  kind: "PodList",
  apiVersion: "v1",
  metadata: {
    resourceVersion: "4423772",
    continue: "ENCODED_CONTINUE_TOKEN",
    remainingItemCount: 7,
  },
  items: [
    {
      metadata: {
        name: "web-0",
        namespace: "shop",
        uid: "5c2a1e0e-1f0a-4c55-9d62-0d6a3b3a6a11",
        labels: { app: "web" },
        annotations: { "kubectl.kubernetes.io/restartedAt": "2026-11-01" },
        managedFields: [{ manager: "kubelet", operation: "Update" }],
      },
      spec: { containers: [{ name: "web", image: "nginx:1.27" }] },
      status: { phase: "Running", podIP: "10.0.0.12" },
    },
    {
      metadata: { name: "web-1", namespace: "shop", uid: "b1" },
      spec: { containers: [] },
      status: { phase: "Pending" },
    },
  ],
};

// A cluster-scoped list: items have no namespace
const CLUSTER_ROLE_LIST = {
  kind: "ClusterRoleList",
  apiVersion: "rbac.authorization.k8s.io/v1",
  metadata: { resourceVersion: "812" },
  items: [
    {
      metadata: { name: "cluster-admin", uid: "c1" },
      rules: [{ apiGroups: ["*"], resources: ["*"], verbs: ["*"] }],
    },
    { metadata: { name: "view", uid: "c2" }, aggregationRule: {}, rules: [] },
  ],
};

// The API server sends `"items": []` for a list with nothing in it
const EMPTY_LIST = {
  kind: "ConfigMapList",
  apiVersion: "v1",
  metadata: { resourceVersion: "9" },
  items: [],
};

const RESPONSES: Record<string, unknown> = {
  "/api/v1/namespaces/shop/pods": POD_LIST,
  "/apis/rbac.authorization.k8s.io/v1/clusterroles": CLUSTER_ROLE_LIST,
  "/api/v1/namespaces/shop/configmaps": EMPTY_LIST,
};

describe("the filter P0 sends with Kubernetes list requests", () => {
  let wsServer: WebSocketServer;
  let target: Server;
  let client: JsonRpcClient;
  let ws: WebSocket;
  let nextId = 1;

  const list = async (path: string) => {
    const id = nextId++;
    const reply = nextMessage(ws);
    ws.send(
      JSON.stringify({
        jsonrpc: "2.0",
        id,
        method: "call",
        params: {
          headers: { [JQ_HEADER]: KUBERNETES_LIST_FILTER },
          method: "GET",
          path,
          params: {},
        },
      })
    );
    return reply;
  };

  beforeAll(async () => {
    target = createServer((req, res) => {
      const body = RESPONSES[req.url ?? ""];
      res.writeHead(body ? 200 : 404, { "content-type": "application/json" });
      res.end(JSON.stringify(body ?? {}));
    });
    await new Promise<void>((resolve) => target.listen(TARGET_PORT, resolve));
    wsServer = new WebSocketServer({ port: WS_PORT });
    const connection = new Promise<WebSocket>((resolve) =>
      wsServer.once("connection", resolve)
    );
    client = new JsonRpcClient(
      {
        targetUrl: `http://localhost:${TARGET_PORT}`,
        clientId: "testClientId",
        jwkPath: ".",
      },
      { host: "localhost", port: WS_PORT, insecure: true }
    );
    ws = await connection;
    const { id } = await nextMessage(ws);
    ws.send(JSON.stringify({ jsonrpc: "2.0", id, result: { ok: true } }));
    await client.waitUntilConnected();
  });

  afterAll(async () => {
    client?.shutdown();
    wsServer?.close();
    await new Promise((resolve) => target?.close(resolve));
  });

  it("keeps the list fields and the name and namespace of each item", async () => {
    const reply = await list("/api/v1/namespaces/shop/pods");

    expect(reply.error).toBeUndefined();
    expect(reply.result).toMatchObject({ status: 200 });
    // toStrictEqual: nothing else may survive the filter
    expect(reply.result.data).toStrictEqual({
      kind: "PodList",
      metadata: POD_LIST.metadata,
      apiVersion: "v1",
      items: [
        { metadata: { name: "web-0", namespace: "shop" } },
        { metadata: { name: "web-1", namespace: "shop" } },
      ],
    });
  });

  it("sets a null namespace on the items of a cluster-scoped list", async () => {
    const reply = await list("/apis/rbac.authorization.k8s.io/v1/clusterroles");

    expect(reply.error).toBeUndefined();
    expect(reply.result.data).toStrictEqual({
      kind: "ClusterRoleList",
      metadata: { resourceVersion: "812" },
      apiVersion: "rbac.authorization.k8s.io/v1",
      items: [
        { metadata: { name: "cluster-admin", namespace: null } },
        { metadata: { name: "view", namespace: null } },
      ],
    });
  });

  it("returns an empty list for a list with no items", async () => {
    const reply = await list("/api/v1/namespaces/shop/configmaps");

    expect(reply.error).toBeUndefined();
    expect(reply.result.data).toStrictEqual({
      kind: "ConfigMapList",
      metadata: { resourceVersion: "9" },
      apiVersion: "v1",
      items: [],
    });
  });

  it("still returns the cluster's own error body unfiltered", async () => {
    const reply = await list("/api/v1/namespaces/missing/pods");

    expect(reply.result).toMatchObject({ status: 404, data: {} });
  });
});
