import express from "express";
import type { Server } from "http";

import { createLogger } from "../log/index.ts";

const logger = createLogger({ name: "health" });

/**
 * Answers health checks. /live follows only the process, so a P0 outage
 * does not make the platform restart the client; /ready follows the tunnel.
 */
export const startHealthServer = (
  port: number,
  isConnected: () => boolean
): Server => {
  const app = express();
  app.get("/live", (_req, res) => {
    res.status(200).json({ message: "OK" });
  });
  app.get("/ready", (_req, res) => {
    if (isConnected()) {
      res.status(200).json({ message: "OK" });
    } else {
      res.status(503).json({ message: "Tunnel not connected" });
    }
  });
  return app.listen(port, () => {
    logger.info(`Health service listening on port ${port}`);
  });
};
