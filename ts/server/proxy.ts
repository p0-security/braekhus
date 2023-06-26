import express, { Request, Router } from "express";
import { pathToRegexp } from "path-to-regexp";
import pinoLogger from "pino";
import audit from "pino-http";
import { RemoteClientRpcServer } from "server";
import { ForwardedRequest, IncomingRequest } from "types";

const logger = pinoLogger({ name: "proxy" });

const PATH = /\/client\/([a-zA-Z0-9-]+)(.*)/;
const PATH_REGEXP = pathToRegexp(PATH);

export const httpProxyApp = (rpcServer: RemoteClientRpcServer) => {
  const app = express();
  app.use(audit({ logger }));

  app.all(PATH, async (req: IncomingRequest, res) => {
    const matches = PATH_REGEXP.exec(req.path);
    if (matches === null || matches.length !== 3) {
      res.sendStatus(400);
    }

    const clientId = (matches as string[])[1];
    const path = (matches as string[])[2];

    const request: ForwardedRequest = {
      path,
      headers: req.headers,
      method: req.method,
      params: req.query,
      data: req.body,
    };
    logger.info({ request }, "forwarded request");
    try {
      const response = await rpcServer.callClient("call", request, clientId);
      Object.entries(response.headers).forEach(([key, value]) => {
        res.setHeader(key, value);
      });
      res.status(response.status).send(response.data);
    } catch (e: any) {
      logger.error({ error: e }, "Error handling request");
      res.sendStatus(500);
    }
  });

  return app;
};
