import express, { Router } from "express";
import { pinoHttp } from "pino-http";

import { createLogger } from "../../log/index.ts";

const logger = createLogger({ name: "testHttpServer" });

export const testHttpServer = (port: number) => {
  const router = Router();

  router.get("/", (req, res) => {
    res.send("root");
  });

  router.get("/happy/path", (req, res) => {
    res.send("hello");
  });

  // Writing without a Content-Length makes Express send Transfer-Encoding: chunked
  router.get("/chunked/error", (req, res) => {
    res.status(503).type("json");
    res.write('{"error":');
    res.end('"unavailable"}');
  });

  const app = express();
  app.use(pinoHttp({ logger }));
  app.use("/", router);

  const httpServer = app.listen(port, () => {
    logger.info(`Test app listening on port ${port}`);
  });

  return httpServer;
};
