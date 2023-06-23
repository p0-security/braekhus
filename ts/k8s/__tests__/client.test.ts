import axios from "axios";
import * as fs from "node:fs/promises";

describe("Kubernetes client", () => {
  it("grant permission", async () => {
    const headers = {
      "Content-Type": "application/json",
    };
    const client = axios.create({
      baseURL: "http://localhost:8081/",
      headers,
      timeout: 10000,
    });

    // 1. Create role
    const role = await fs.readFile("k8s/__tests__/role.json", {
      encoding: "utf-8",
    });
    await client.post(
      "apis/rbac.authorization.k8s.io/v1/namespaces/default/roles",
      role,
      {
        params: {
          clusterId: "myClusterId",
        },
      }
    );

    // 2. Create role binding
    const roleBinding = await fs.readFile("k8s/__tests__/rolebinding.json", {
      encoding: "utf-8",
    });
    await client.post(
      "apis/rbac.authorization.k8s.io/v1/namespaces/default/rolebindings",
      roleBinding,
      {
        params: {
          clusterId: "myClusterId",
        },
      }
    );

    // 3. Update config map
    const configMap = await fs.readFile("k8s/__tests__/configmap-grant.json", {
      encoding: "utf-8",
    });
    await client.put(
      "/api/v1/namespaces/kube-system/configmaps/aws-auth",
      configMap,
      {
        params: {
          clusterId: "myClusterId",
        },
      }
    );
  });

  it("revoke permission", async () => {
    const headers = {
      "Content-Type": "application/json",
    };
    const client = axios.create({
      baseURL: "http://localhost:8081/",
      headers,
      timeout: 10000,
    });

    // 1. Delete role
    await client.delete(
      "apis/rbac.authorization.k8s.io/v1/namespaces/default/roles/pod-reader",
      {
        params: {
          clusterId: "myClusterId",
        },
      }
    );

    // 2. Delete role binding
    await client.delete(
      "apis/rbac.authorization.k8s.io/v1/namespaces/default/rolebindings/read-pods",
      {
        params: {
          clusterId: "myClusterId",
        },
      }
    );

    // 3. Update config map
    const configMap = await fs.readFile("k8s/__tests__/configmap-revoke.json", {
      encoding: "utf-8",
    });
    await client.put(
      "/api/v1/namespaces/kube-system/configmaps/aws-auth",
      configMap,
      {
        params: {
          clusterId: "myClusterId",
        },
      }
    );
  });
});
