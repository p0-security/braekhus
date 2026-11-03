import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  JQ_INPUT_LIMIT_MODE_ENV,
  JQ_MAX_INPUT_BYTES_ENV,
  jqInputLimit,
  jqProgram,
  jqTransform,
  parseBody,
} from "../filter.ts";

const exampleResponse = {
  status: 200,
  statusText: "OK",
  data: {
    kind: "ClusterRoleList",
    apiVersion: "rbac.authorization.k8s.io/v1",
    metadata: {
      resourceVersion: "4423772",
    },
    items: [
      {
        metadata: {
          name: "admin",
          uid: "4251609f-b3ca-4875-8ec6-76b40ab62748",
          resourceVersion: "345",
          managedFields: [
            {
              manager: "clusterrole-aggregation-controller",
              operation: "Apply",
            },
            {
              manager: "kube-apiserver",
              operation: "Update",
            },
          ],
        },
      },
      {
        metadata: {
          name: "aws-node",
          uid: "63a3bed8-a750-440d-bca9-b5f41c8786c2",
          resourceVersion: "273",
          managedFields: [
            {
              manager: "kubectl-client-side-apply",
              operation: "Update",
            },
          ],
        },
      },
    ],
  },
};

const logger = vi.hoisted(() => ({
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}));
vi.mock("../../log/index.ts", () => ({ createLogger: () => logger }));

const body = (value: unknown) => Buffer.from(JSON.stringify(value));

describe("json path filter", () => {
  it("returns only selected fields", async () => {
    const result = await jqTransform(
      body(exampleResponse),
      "{ status: .status, data: { kind: .data.kind, items: [.data.items[] | { metadata: { name: .metadata.name } }] } }"
    );

    expect(result).toMatchSnapshot();
  });

  describe("fails instead of returning the original data", () => {
    it("on an invalid program", async () => {
      await expect(jqTransform(body(exampleResponse), "{ { }")).rejects.toThrow(
        /compile error/
      );
    });

    it("on a runtime error", async () => {
      await expect(
        jqTransform(body({ kind: "Status" }), "[.items[] | .name]")
      ).rejects.toThrow(/Cannot iterate over null/);
    });

    it("on an invalid program with a body larger than the pipe buffer", async () => {
      const data = { items: "x".repeat(5 * 1024 * 1024) };

      await expect(jqTransform(body(data), ".items[")).rejects.toThrow(
        /compile error/
      );
    });
  });

  describe("input limit", () => {
    const withEnv = async (
      env: Record<string, string | undefined>,
      run: () => Promise<void>
    ) => {
      const previous = Object.fromEntries(
        Object.keys(env).map((key) => [key, process.env[key]])
      );
      const set = (values: Record<string, string | undefined>) => {
        for (const [key, value] of Object.entries(values)) {
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        }
      };
      set(env);
      try {
        await run();
      } finally {
        set(previous);
      }
    };
    const withLimit = (value: string | undefined, run: () => Promise<void>) =>
      withEnv({ [JQ_MAX_INPUT_BYTES_ENV]: value }, run);
    const withWarnMode = (
      value: string | undefined,
      run: () => Promise<void>
    ) =>
      withEnv(
        {
          [JQ_MAX_INPUT_BYTES_ENV]: value,
          [JQ_INPUT_LIMIT_MODE_ENV]: "warn",
        },
        run
      );

    beforeEach(() => {
      logger.warn.mockClear();
    });

    it("has no limit by default", async () => {
      await withLimit(undefined, async () => {
        expect(jqInputLimit()).toEqual({ maxBytes: undefined, enforce: true });
        // Larger than the 32 MiB warn-mode default
        const input = Buffer.from(
          JSON.stringify({ items: "x".repeat(33 * 1024 * 1024) })
        );

        await expect(jqTransform(input, ".items | length")).resolves.toBe(
          33 * 1024 * 1024
        );
      });
    });

    it("rejects an input larger than the limit without running jq", async () => {
      await withLimit("100", async () => {
        const data = { items: "x".repeat(101) };

        // `jq .` would succeed on this input, so only the limit can fail it
        await expect(jqTransform(body(data), ".")).rejects.toThrow(
          /larger than the jq input limit of 100 bytes/
        );
      });
    });

    it("accepts an input within the limit", async () => {
      await withLimit("1000", async () => {
        await expect(jqTransform(body({ a: 1 }), ".a")).resolves.toBe(1);
      });
    });

    it("does not limit the output", async () => {
      await withLimit("100", async () => {
        const result = await jqTransform(
          body({ n: 5 }),
          '[range(.n)] | map("x" * 50)'
        );

        expect(result).toHaveLength(5);
      });
    });

    it.each(["abc", "0", "-5", "1.5"])(
      "ignores %s as a limit",
      async (value) => {
        await withLimit(value, async () => {
          expect(jqInputLimit().maxBytes).toBeUndefined();
          await expect(jqTransform(body({ a: 1 }), ".a")).resolves.toBe(1);
        });
      }
    );

    describe("in warn mode", () => {
      it("runs jq on an input over the limit and logs a warning", async () => {
        await withWarnMode("100", async () => {
          const data = { items: "x".repeat(101) };

          await expect(
            jqTransform(body(data), ".items | length")
          ).resolves.toBe(101);
          expect(logger.warn).toHaveBeenCalledTimes(1);
          expect(logger.warn).toHaveBeenCalledWith(
            expect.objectContaining({ maxBytes: 100, bytes: 113 }),
            expect.stringContaining("larger than the jq input limit of 100")
          );
        });
      });

      it("warns on every input over the limit", async () => {
        await withWarnMode("10", async () => {
          await jqTransform(body({ a: "x".repeat(20) }), ".a");
          await jqTransform(body({ a: "x".repeat(20) }), ".a");

          expect(logger.warn).toHaveBeenCalledTimes(2);
        });
      });

      it("does not warn about an input within the limit", async () => {
        await withWarnMode("1000", async () => {
          await jqTransform(body({ a: 1 }), ".a");

          expect(logger.warn).not.toHaveBeenCalled();
        });
      });

      it("defaults the limit to 32 MiB", async () => {
        await withWarnMode(undefined, async () => {
          expect(jqInputLimit()).toEqual({
            maxBytes: 32 * 1024 * 1024,
            enforce: false,
          });
        });
      });
    });

    it("enforces the limit when the mode is not recognized", async () => {
      await withEnv(
        { [JQ_MAX_INPUT_BYTES_ENV]: "100", [JQ_INPUT_LIMIT_MODE_ENV]: "off" },
        async () => {
          expect(jqInputLimit()).toEqual({ maxBytes: 100, enforce: true });
          expect(logger.warn).toHaveBeenCalledWith(
            { value: "off" },
            expect.stringContaining(JQ_INPUT_LIMIT_MODE_ENV)
          );
        }
      );
    });
  });

  it("does not expose the client environment to the filter", async () => {
    process.env.BRAEKHUS_JQ_SENTINEL = "should-not-leak";
    try {
      const result = await jqTransform(
        body({ a: 1 }),
        'env.BRAEKHUS_JQ_SENTINEL // "unset"'
      );
      expect(result).toBe("unset");
    } finally {
      delete process.env.BRAEKHUS_JQ_SENTINEL;
    }
  });

  it("takes the first program when the header is repeated", () => {
    expect(jqProgram([".a", ".b"])).toBe(".a");
    expect(jqProgram(".a")).toBe(".a");
    expect(jqProgram(undefined)).toBeUndefined();
    expect(jqProgram("")).toBeUndefined();
  });

  it("parses a raw body as JSON, or returns the text when it is not JSON", () => {
    expect(parseBody(body({ a: 1 }))).toEqual({ a: 1 });
    expect(parseBody(Buffer.from("not json"))).toBe("not json");
    expect(parseBody(Buffer.alloc(0))).toBe("");
  });
});
