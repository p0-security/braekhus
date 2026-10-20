import express, { Router } from "express";

import { createLogger, newHttpLogger } from "../../log/index.ts";

const logger = createLogger({ name: "testHttpServer" });

export const testHttpServer = (port: number) => {
  const router = Router();

  router.get("/", (req, res) => {
    res.send("root");
  });

  router.get("/happy/path", (req, res) => {
    res.send("hello");
  });

  router.post("/echo/size", express.json({ limit: "10mb" }), (req, res) => {
    res.json({ size: JSON.stringify(req.body).length });
  });

  // Echoes the request's header names, and answers with a credential and a
  // hop-by-hop header the proxy must not pass back
  router.post("/echo/headers", express.json(), (req, res) => {
    res.setHeader("connection", "keep-alive, x-target-hop");
    res.setHeader("x-target-hop", "1");
    res.setHeader("set-cookie", req.body.setCookie);
    res.json({ headers: Object.keys(req.headers), secret: req.body.secret });
  });

  const app = express();
  app.use(newHttpLogger({ logger }));
  app.use("/", router);

  const httpServer = app.listen(port, () => {
    logger.info(`Test app listening on port ${port}`);
  });

  return httpServer;
};
