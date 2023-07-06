import express from "express";
import { omit } from "lodash";
import { pathToRegexp } from "path-to-regexp";
import audit from "pino-http";
import { RemoteClientRpcServer } from "server";
import { ForwardedRequest, IncomingRequest } from "types";

import { createLogger } from "../log";

const logger = createLogger({ name: "proxy" });

const PATH = /\/client\/([a-zA-Z0-9-]+)(.*)/;
const PATH_REGEXP = pathToRegexp(PATH);

export const httpProxyApp = (rpcServer: RemoteClientRpcServer) => {
  const app = express();
  app.use(audit({ logger }));

  // In order to populate the `request.body` attribute in express we must define body-parser middlewares.
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(express.text());
  app.use(express.raw());

  app.all(PATH, async (req: IncomingRequest, res) => {
    const matches = PATH_REGEXP.exec(req.path);
    logger.debug({ matches }, "path matches");
    if (matches === null || matches.length !== 3) {
      res.sendStatus(400);
    }

    const clientId = (matches as string[])[1];
    const path = (matches as string[])[2];
    const request: ForwardedRequest = {
      path,
      headers: omit(req.headers, "proxy-authorization"),
      method: req.method,
      params: req.query,
      data: req.body,
    };
    logger.info({ request: omit(request, "body") }, "forwarded request");
    logger.debug({ body: req.body }, "forwarded request body");
    try {
      const response = await rpcServer.callClient("call", request, clientId);
      Object.entries(response.headers).forEach(([key, value]) => {
        res.setHeader(key, value);
      });
      res.status(response.status).send(response.data);
    } catch (e: any) {
      logger.error({ error: e }, "error handling request");
      res.sendStatus(502);
    }
  });

  return app;
};
