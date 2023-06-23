import {
  Create,
  Delete,
  IndirectK8sApiResponse,
  Patch,
  Read,
  Replace,
} from "../types";
import {
  KubeConfig,
  RbacAuthorizationV1Api,
  CoreV1Api,
  V1ConfigMap,
  V1Role,
  V1RoleBinding,
} from "@kubernetes/client-node";

export class K8sClient {
  #rbacApi: RbacAuthorizationV1Api;
  #coreApi: CoreV1Api;

  constructor() {
    const kc = new KubeConfig();
    kc.loadFromDefault();
    this.#rbacApi = kc.makeApiClient(RbacAuthorizationV1Api);
    this.#coreApi = kc.makeApiClient(CoreV1Api);
  }

  async readRole(request: Read) {
    const { name, namespace } = request;
    return unwrap(this.#rbacApi.readNamespacedRole(name, namespace));
  }

  async createRole(request: Create<V1Role>) {
    const { namespace, body } = request;
    return unwrap(this.#rbacApi.createNamespacedRole(namespace, body));
  }

  async deleteRole(request: Delete) {
    const { name, namespace } = request;
    return unwrap(this.#rbacApi.deleteNamespacedRole(name, namespace));
  }

  async readRoleBinding(request: Read) {
    const { name, namespace } = request;
    return unwrap(this.#rbacApi.readNamespacedRoleBinding(name, namespace));
  }

  async createRoleBinding(request: Create<V1RoleBinding>) {
    const { namespace, body } = request;
    return unwrap(this.#rbacApi.createNamespacedRoleBinding(namespace, body));
  }

  async deleteRoleBinding(request: Delete) {
    const { name, namespace } = request;
    return unwrap(this.#rbacApi.deleteNamespacedRoleBinding(name, namespace));
  }

  // ConfigMap
  async readConfigMap(request: Read) {
    const { name, namespace } = request;
    // Permission boundary: only allow reading the aws-auth configmap
    // if (name !== "aws-auth") {
    //   throw httpError(403, "Forbidden", JSON.stringify(new Error("Not allowed to read ConfigMap")));
    // }
    return unwrap(this.#coreApi.readNamespacedConfigMap(name, namespace));
  }

  async createConfigMap(request: Create<V1ConfigMap>) {
    const { namespace, body } = request;
    return unwrap(this.#coreApi.createNamespacedConfigMap(namespace, body));
  }

  async replaceConfigMap(request: Replace<V1ConfigMap>) {
    const { name, namespace, body } = request;
    return unwrap(
      this.#coreApi.replaceNamespacedConfigMap(name, namespace, body)
    );
  }

  async patchConfigMap(request: Patch<V1ConfigMap>) {
    const { name, namespace, body } = request;
    return unwrap(
      this.#coreApi.patchNamespacedConfigMap(name, namespace, body)
    );
  }

  async deleteConfigMap(request: Delete) {
    const { name, namespace } = request;
    return unwrap(this.#coreApi.deleteNamespacedConfigMap(name, namespace));
  }
}

/**
 * Only returns the response body from the Kubernetes API server.
 * If the request errored, return the Status object, which is, again, only the response body from the API server.
 * @param promise
 * @returns
 */
const unwrap = async <T>(promise: Promise<{ body: T }>) => {
  const makeResponse = (data: any): IndirectK8sApiResponse => {
    if (!data.response) {
      throw new Error("Malformed response");
    }
    return {
      statusCode: data.response.statusCode,
      statusMessage: data.response.statusMessage,
      body: data.body,
    };
  };

  try {
    const result = await promise;
    return makeResponse(result);
  } catch (err: any) {
    try {
      return makeResponse(err);
    } catch (err2: any) {
      throw err;
    }
  }
};
