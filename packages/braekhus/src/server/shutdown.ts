import type { IncomingMessage, Server, ServerResponse } from "node:http";

import { createLogger } from "../log/index.ts";
import type { JsonRpcApp } from "./index.ts";

const logger = createLogger({ name: "shutdown" });

// One proxied request can run past 5 s: its retry sleeps alone add up to 5.75 s.
// The drain and the tunnel close must end before P0's service shutdown gives
// up, 20 s after SIGTERM, or the tunnels never get their close frame.
export const DRAIN_TIMEOUT_MILLIS = 15000;

export const TUNNEL_CLOSE_TIMEOUT_MILLIS = 1000;

export const SERVICE_RESTART_CLOSE_CODE = 1012;

const timesOut = async (promise: Promise<unknown>, millis: number) => {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(true), millis);
  });
  try {
    return await Promise.race([promise.then(() => false), timeout]);
  } finally {
    clearTimeout(timer);
  }
};

// server.close() waits for every socket, and a keep-alive socket stays open
// after its response. While closing, each response asks the client to close
// with Connection: close. A response can still go out as keep-alive, when its
// headers were sent before the drain, so its socket is closed once it is idle.
const closeAfterResponses = (
  server: Server<typeof IncomingMessage, typeof ServerResponse>
) => {
  let closing = false;
  const inFlight = new Set<ServerResponse>();
  server.prependListener("request", (_req, res) => {
    if (closing) res.setHeader("Connection", "close");
    inFlight.add(res);
    res.once("close", () => {
      inFlight.delete(res);
      if (closing) server.closeIdleConnections();
    });
  });
  return () =>
    new Promise<void>((resolve) => {
      closing = true;
      for (const res of inFlight) {
        if (!res.headersSent) res.setHeader("Connection", "close");
      }
      server.close(() => resolve());
    });
};

/** Returns the drain to run on SIGTERM. It must be created at startup, so it
 * sees every request that is in flight when the drain starts.
 *
 * The drain stops both listeners, waits for in-flight proxied requests, then
 * closes every tunnel with code 1012 so its client reconnects to another pod.
 */
export const createDrain = (
  proxyServer: Server<typeof IncomingMessage, typeof ServerResponse>,
  jsonRpcApp: JsonRpcApp
) => {
  const closeProxy = closeAfterResponses(proxyServer);
  return async () => {
    jsonRpcApp.shutdown();
    if (await timesOut(closeProxy(), DRAIN_TIMEOUT_MILLIS)) {
      logger.warn("Drain timed out with requests in flight");
    }
    // In-flight proxied requests get their responses over the tunnels, so the tunnels close last
    const tunnelsClosed = jsonRpcApp
      .getRpcServer()
      .closeChannels(SERVICE_RESTART_CLOSE_CODE, "Server shutting down");
    if (await timesOut(tunnelsClosed, TUNNEL_CLOSE_TIMEOUT_MILLIS)) {
      logger.warn("Tunnels did not finish closing");
    }
  };
};
