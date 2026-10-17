import { metrics } from "@opentelemetry/api";
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Backoff } from "../../client/backoff.ts";
import { JsonRpcClient } from "../../client/index.ts";
import { NotFoundError } from "../error.ts";
import type { RemoteClientRpcServer } from "../index.ts";
import { ensureKey } from "../key-cache.ts";

// Set before the dynamic imports below, so the instruments bind to this provider.
const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
const reader = new PeriodicExportingMetricReader({
  exporter,
  exportIntervalMillis: 60_000,
});
const provider = new MeterProvider({ readers: [reader] });
metrics.setGlobalMeterProvider(provider);

const PROXY_REQUESTS = "braekhus.proxy.requests";
const TUNNELS_CONNECTED = "braekhus.tunnels.connected";

let httpProxyApp: typeof import("../proxy.ts").httpProxyApp;
let runApp: typeof import("../index.ts").runApp;

type Series = Map<
  string,
  { attributes: Record<string, unknown>; value: number }
>;

const sleep = (millis: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, millis));

const waitFor = async <T>(
  read: () => Promise<T>,
  done: (value: T) => boolean
): Promise<T> => {
  const deadline = Date.now() + 2000;
  let value = await read();
  while (!done(value) && Date.now() < deadline) {
    await sleep(10);
    value = await read();
  }
  return value;
};

const readSeries = async (name: string): Promise<Series> => {
  await reader.forceFlush();
  const series: Series = new Map();
  // Cumulative exports are ordered oldest first, so later batches overwrite earlier values.
  for (const batch of exporter.getMetrics()) {
    for (const scope of batch.scopeMetrics) {
      for (const metric of scope.metrics) {
        if (metric.descriptor.name !== name) continue;
        for (const point of metric.dataPoints) {
          series.set(JSON.stringify(Object.entries(point.attributes).sort()), {
            attributes: point.attributes,
            value: point.value as number,
          });
        }
      }
    }
  }
  return series;
};

const changesSince = (before: Series, after: Series) =>
  [...after].flatMap(([key, { attributes, value }]) => {
    const count = value - (before.get(key)?.value ?? 0);
    return count === 0 ? [] : [{ ...attributes, count }];
  });

// Returns the proxy counter increments caused by `run`. The close event can fire after supertest resolves,
// so this waits for the increment to show up.
const recordedBy = async (run: () => Promise<unknown>) => {
  const before = await readSeries(PROXY_REQUESTS);
  await run();
  return waitFor(
    async () => changesSince(before, await readSeries(PROXY_REQUESTS)),
    (changes) => changes.length > 0
  );
};

const proxyWith = (callClientWithRetry: (...args: any[]) => Promise<unknown>) =>
  httpProxyApp({
    callClientWithRetry,
  } as unknown as RemoteClientRpcServer);

beforeAll(async () => {
  ({ httpProxyApp } = await import("../proxy.ts"));
  ({ runApp } = await import("../index.ts"));
});

afterAll(async () => {
  await provider.shutdown();
});

describe("proxy request metrics", () => {
  it("records ok with the upstream status on a 200", async () => {
    const app = proxyWith(async () => ({
      status: 200,
      headers: {},
      data: "hello",
    }));

    const [change] = await recordedBy(() =>
      request(app).get("/client/testClientId/happy/path")
    );

    expect(change).toEqual({ status_code: 200, outcome: "ok", count: 1 });
  });

  it("records ok with the upstream status on a 404 from the target", async () => {
    const app = proxyWith(async () => ({
      status: 404,
      headers: {},
      data: "missing",
    }));

    const [change] = await recordedBy(() =>
      request(app).get("/client/testClientId/unhappy/path")
    );

    expect(change).toEqual({ status_code: 404, outcome: "ok", count: 1 });
  });

  it("records ok for a chunked response", async () => {
    const app = proxyWith(async () => ({
      status: 200,
      headers: { "transfer-encoding": "chunked" },
      data: { streamed: true },
    }));

    const [change] = await recordedBy(() =>
      request(app).get("/client/testClientId")
    );

    expect(change).toEqual({ status_code: 200, outcome: "ok", count: 1 });
  });

  it("records timeout on a 504", async () => {
    const app = proxyWith(async () => {
      throw new Error("Request timeout");
    });

    const [change] = await recordedBy(() =>
      request(app).get("/client/testClientId")
    );

    expect(change).toEqual({ status_code: 504, outcome: "timeout", count: 1 });
  });

  it("records client_not_found on a 502 for an unknown client", async () => {
    const app = proxyWith(async () => {
      throw new NotFoundError("noSuchClientId", "client");
    });

    const [change] = await recordedBy(() =>
      request(app).get("/client/noSuchClientId")
    );

    expect(change).toEqual({
      status_code: 502,
      outcome: "client_not_found",
      count: 1,
    });
  });

  it("records error on a 502 for other failures", async () => {
    const app = proxyWith(async () => {
      throw new Error("connect ECONNREFUSED");
    });

    const [change] = await recordedBy(() =>
      request(app).get("/client/testClientId")
    );

    expect(change).toEqual({ status_code: 502, outcome: "error", count: 1 });
  });

  it("records rejected on a 413 from an oversized body", async () => {
    const app = proxyWith(async () => {
      throw new Error("the handler should not run for a rejected body");
    });

    const [change] = await recordedBy(() =>
      request(app)
        .post("/client/testClientId")
        .set("Content-Type", "application/json")
        .send(JSON.stringify({ blob: "x".repeat(1_500_000) }))
    );

    expect(change).toEqual({ status_code: 413, outcome: "rejected", count: 1 });
  });
});

describe("tunnel connected gauge", () => {
  const connectedTunnels = async () => {
    const series = await readSeries(TUNNELS_CONNECTED);
    return [...series.values()].reduce((sum, { value }) => sum + value, 0);
  };

  it("reads 1 after a client connects and 0 after it disconnects", async () => {
    const app = runApp({
      appContext: { rpcPort: 18280, proxyPort: 18281 },
      publicKeyGetter: ensureKey,
    });
    const jsonRpcClient = new JsonRpcClient(
      {
        targetUrl: "http://localhost:18282",
        clientId: "gaugeClientId",
        jwkPath: ".",
      },
      {
        host: "localhost",
        port: 18280,
        insecure: true,
        backoff: new Backoff(500, 500),
      }
    );
    try {
      await jsonRpcClient.run();
      await jsonRpcClient.waitUntilConnected();
      expect(await connectedTunnels()).toBe(1);

      jsonRpcClient.shutdown();
      expect(await waitFor(connectedTunnels, (count) => count === 0)).toBe(0);
    } finally {
      jsonRpcClient.shutdown();
      app.expressHttpServer.close();
      app.jsonRpcApp.shutdown();
    }
  });
});
