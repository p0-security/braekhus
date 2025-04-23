import express, { Router } from "express";
import { createLogger } from "log/index";
import { pinoHttp as audit } from "pino-http";

const logger = createLogger({ name: "testHttpServer" });

export const testHttpServer = (port: number) => {
  const router = Router();

  router.get("/", (req, res) => {
    res.send("root");
  });

  router.get("/happy/path", (req, res) => {
    res.send("hello");
  });

  const app = express();
  app.use(audit({ logger }));
  app.use("/", router);

  const httpServer = app.listen(port, () => {
    logger.info(`Test app listening on port ${port}`);
  });

  return httpServer;
};
