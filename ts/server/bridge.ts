import express, { Request, Router } from "express";
import pinoLogger from "pino";
import audit from "pino-http";
import { PermissionerRpcServer } from "server";
import { ClusterPermission } from "types";

const logger = pinoLogger({ name: "bridge" });

type PermissionerRequest = Request<
  {},
  any,
  ClusterPermission,
  object,
  Record<string, any>
>;

export const httpBridgeApp = (rpcServer: PermissionerRpcServer) => {
  const app = express();
  app.use(audit({ logger }));

  app.use("", getRouter(rpcServer));

  return app;
};

const getRouter = (rpcServer: PermissionerRpcServer) => {
  const router = Router();
  router.use(express.json());

  router.post("/grant", async (req: PermissionerRequest, res) => {
    const { clusterIds, permission } = req.body;
    logger.info({ clusterIds, permission }, "granting");
    try {
      await rpcServer.callClusters("grant", permission, ...clusterIds);
      res.json({
        ok: true,
        clusterIds,
      });
    } catch (e: any) {
      logger.error({ error: e }, "Error handling request");
      res.status(500).json({ ok: false });
    }
  });

  router.post("/revoke", async (req: PermissionerRequest, res) => {
    const { clusterIds, permission } = req.body;
    logger.info({ clusterIds, permission }, "revoking");
    try {
      await rpcServer.callClusters("revoke", permission, ...clusterIds);
      res.json({
        ok: true,
        clusterIds,
      });
    } catch (e: any) {
      logger.error({ error: e }, "Error handling request");
      res.status(500).json({ ok: false });
    }
  });

  return router;
};
