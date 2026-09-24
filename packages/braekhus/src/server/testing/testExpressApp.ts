import express, { Router } from "express";
import { pinoHttp } from "pino-http";

import { createLogger } from "../../log/index.ts";

const logger = createLogger({ name: "testHttpServer" });

/** Methods of requests that reached `/count`, in arrival order. Tests clear it between cases. */
export const countedRequests: string[] = [];

export const testHttpServer = (port: number) => {
  const router = Router();

  router.get("/", (req, res) => {
    res.send("root");
  });

  router.get("/happy/path", (req, res) => {
    res.send("hello");
  });

  router.all("/count", (req, res) => {
    countedRequests.push(req.method);
    setTimeout(() => res.send("counted"), Number(req.query.delayMillis ?? 0));
  });

  const app = express();
  app.use(pinoHttp({ logger }));
  app.use("/", router);

  const httpServer = app.listen(port, () => {
    logger.info(`Test app listening on port ${port}`);
  });

  return httpServer;
};
