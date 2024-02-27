import express from "express";
import { JsonStreamStringify } from "json-stream-stringify";
import { omit } from "lodash";
import { pathToRegexp } from "path-to-regexp";
import audit from "pino-http";

import { RetryOptions } from "../client/backoff";
import { createLogger } from "../log";
import { RemoteClientRpcServer } from "../server";
import {
  CallOptions,
  ForwardedRequest,
  ForwardedRequestOptions,
  IncomingRequest,
} from "../types";

const logger = createLogger({ name: "proxy" });

const PATH = /\/client\/([^/]+)(.*)/;
const PATH_REGEXP = pathToRegexp(PATH);

export const httpProxyApp = (
  rpcServer: RemoteClientRpcServer,
  options?: {
    callOptions?: CallOptions;
    forwardedRequestOptions?: ForwardedRequestOptions;
    retryOptions?: RetryOptions;
  }
) => {
  const app = express();
  app.use(audit({ logger, useLevel: "debug" }));

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
      options: options?.forwardedRequestOptions,
    };
    logger.debug({ request }, "forwarded request");
    try {
      const response = await rpcServer.callClientWithRetry(
        "call",
        request,
        clientId,
        options?.callOptions,
        options?.retryOptions
      );
      const isChunked =
        response.headers["transfer-encoding"]?.trim() === "chunked";
      Object.entries<string>(response.headers).forEach(([key, value]) => {
        res.setHeader(key, value);
      });
      logger.debug({ isChunked }, "chunked");
      // If the Kubernetes server sends "Transfer-Encoding: chunked" data then we must stream the response by piping it.
      // If we `send` the data we get an error saying both "Transfer-Encoding" and "Content-Length" headers cannot be
      // present. "Content-Length" is added by express if you `send`.
      if (isChunked) {
        // TODO: Do we have to forward status code separately? Can the response ever be chunked and non-200?
        const stream = new JsonStreamStringify(response.data);
        // By default, stream.end() is called on the destination Writable stream when the source Readable stream emits 'end', so that the destination is no longer writable.
        // See See https://nodejs.org/api/stream.html#readablepipedestination-options
        stream.pipe(res);
      } else {
        res.status(response.status).send(response.data);
      }
    } catch (error: any) {
      logger.error({ error, spammy: true }, "Error handling request");
      if (
        // Timeout waiting for response on the the websocket channel
        error.message === "Request timeout" ||
        // Timeout in axios client from proxy to target service (e.g. Kubernetes API server) - "timeout of 1000ms exceeded"
        (error.message.startsWith("timeout") &&
          error.message.endsWith("exceeded"))
      ) {
        res.sendStatus(504);
      } else {
        res.sendStatus(502);
      }
    }
  });

  return app;
};
