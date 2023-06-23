import { PermissionerRpcServer } from ".";
import { IndirectK8sApiResponse } from "../types";
import { V1ConfigMap, V1Role, V1RoleBinding } from "@kubernetes/client-node";
import express, { Request, Response, Router } from "express";
import pinoLogger from "pino";
import audit from "pino-http";

const logger = pinoLogger({ name: "bridge" });

type ApiRequest<P, REQ, Q> = Request<P, any, REQ, Q, Record<string, any>>;

export const k8sProxy = (rpcServer: PermissionerRpcServer) => {
  const app = express();
  app.use(audit({ logger }));

  app.use("/api/v1", CoreV1Router(rpcServer));
  app.use(
    "/apis/rbac.authorization.k8s.io/v1",
    RbacAuthorizationV1Router(rpcServer)
  );

  return app;
};

const CoreV1Router = (rpcServer: PermissionerRpcServer) => {
  const router = Router();
  router.use(express.json());

  /**
   * Read the specified ConfigMap
   *
   * https://kubernetes.io/docs/reference/generated/kubernetes-api/v1.27/#read-configmap-v1-core
   */
  router.get(
    "/namespaces/:namespace/configmaps/:name",
    async (
      req: ApiRequest<
        { namespace: string; name: string },
        object,
        { clusterId: string }
      >,
      res
    ) => {
      const { clusterId } = req.query;
      const { namespace, name } = req.params;
      await unwrap(
        rpcServer.callCluster("readConfigMap", { name, namespace }, clusterId),
        res
      );
    }
  );

  /**
   * Create a ConfigMap
   *
   * https://kubernetes.io/docs/reference/generated/kubernetes-api/v1.27/#create-configmap-v1-core
   */
  router.post(
    "/namespaces/:namespace/configmaps",
    async (
      req: ApiRequest<
        { namespace: string },
        V1ConfigMap,
        { clusterId: string }
      >,
      res
    ) => {
      const { clusterId } = req.query;
      const { namespace } = req.params;
      const body = req.body;
      await unwrap(
        rpcServer.callCluster(
          "createConfigMap",
          { namespace, body },
          clusterId
        ),
        res
      );
    }
  );

  /**
   * Replace the specified a ConfigMap
   *
   * https://kubernetes.io/docs/reference/generated/kubernetes-api/v1.27/#replace-configmap-v1-core
   */
  router.put(
    "/namespaces/:namespace/configmaps/:name",
    async (
      req: ApiRequest<
        { namespace: string; name: string },
        V1ConfigMap,
        { clusterId: string }
      >,
      res
    ) => {
      const { clusterId } = req.query;
      const { namespace, name } = req.params;
      const body = req.body;
      await unwrap(
        rpcServer.callCluster(
          "replaceConfigMap",
          { namespace, name, body },
          clusterId
        ),
        res
      );
    }
  );

  /**
   * Delete a ConfigMap
   *
   * https://kubernetes.io/docs/reference/generated/kubernetes-api/v1.27/#delete-configmap-v1-core
   */
  router.get(
    "/namespaces/:namespace/configmaps/:name",
    async (
      req: ApiRequest<
        { namespace: string; name: string },
        object,
        { clusterId: string }
      >,
      res
    ) => {
      const { clusterId } = req.query;
      const { namespace, name } = req.params;
      await unwrap(
        rpcServer.callCluster(
          "deleteConfigMap",
          { name, namespace },
          clusterId
        ),
        res
      );
    }
  );

  return router;
};

const RbacAuthorizationV1Router = (rpcServer: PermissionerRpcServer) => {
  const router = Router();
  router.use(express.json());

  /**
   * Read the specified Role
   *
   * https://kubernetes.io/docs/reference/generated/kubernetes-api/v1.27/#read-role-v1-rbac-authorization-k8s-io
   */
  router.get(
    "/namespaces/:namespace/roles/:name",
    async (
      req: ApiRequest<
        { namespace: string; name: string },
        object,
        { clusterId: string }
      >,
      res
    ) => {
      const { clusterId } = req.query;
      const { namespace, name } = req.params;
      await unwrap(
        rpcServer.callCluster("readRole", { name, namespace }, clusterId),
        res
      );
    }
  );

  /**
   * Create a Role
   *
   * https://kubernetes.io/docs/reference/generated/kubernetes-api/v1.27/#create-role-v1-rbac-authorization-k8s-io
   */
  router.post(
    "/namespaces/:namespace/roles",
    async (
      req: ApiRequest<{ namespace: string }, V1Role, { clusterId: string }>,
      res
    ) => {
      const { clusterId } = req.query;
      const { namespace } = req.params;
      const body = req.body;
      await unwrap(
        rpcServer.callCluster("createRole", { namespace, body }, clusterId),
        res
      );
    }
  );

  /**
   * Delete a Role
   *
   * https://kubernetes.io/docs/reference/generated/kubernetes-api/v1.27/#delete-role-v1-rbac-authorization-k8s-io
   */
  router.delete(
    "/namespaces/:namespace/roles/:name",
    async (
      req: ApiRequest<
        { namespace: string; name: string },
        object,
        { clusterId: string }
      >,
      res
    ) => {
      const { clusterId } = req.query;
      const { namespace, name } = req.params;
      await unwrap(
        rpcServer.callCluster("deleteRole", { name, namespace }, clusterId),
        res
      );
    }
  );

  /**
   * Create a RoleBinding
   *
   * https://kubernetes.io/docs/reference/generated/kubernetes-api/v1.27/#create-rolebinding-v1-rbac-authorization-k8s-io
   */
  router.post(
    "/namespaces/:namespace/rolebindings",
    async (
      req: ApiRequest<
        { namespace: string },
        V1RoleBinding,
        { clusterId: string }
      >,
      res
    ) => {
      const { clusterId } = req.query;
      const { namespace } = req.params;
      const body = req.body;
      await unwrap(
        rpcServer.callCluster(
          "createRoleBinding",
          { namespace, body },
          clusterId
        ),
        res
      );
    }
  );

  /**
   * Delete a RoleBinding
   *
   * https://kubernetes.io/docs/reference/generated/kubernetes-api/v1.27/#delete-rolebinding-v1-rbac-authorization-k8s-io
   */
  router.delete(
    "/namespaces/:namespace/rolebindings/:name",
    async (
      req: ApiRequest<
        { namespace: string; name: string },
        object,
        { clusterId: string }
      >,
      res
    ) => {
      const { clusterId } = req.query;
      const { namespace, name } = req.params;
      await unwrap(
        rpcServer.callCluster(
          "deleteRoleBinding",
          { name, namespace },
          clusterId
        ),
        res
      );
    }
  );

  return router;
};

const unwrap = async (
  promise: Promise<IndirectK8sApiResponse>,
  res: Response<any>
) => {
  try {
    const response: IndirectK8sApiResponse = await promise;
    res.status(response.statusCode).json(response.body);
  } catch (e: any) {
    res.status(502).json({ error: e });
  }
};
