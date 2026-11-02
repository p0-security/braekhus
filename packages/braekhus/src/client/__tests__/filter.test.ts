import { describe, expect, it } from "vitest";

import { JQ_MAX_INPUT_BYTES_ENV, jqTransform } from "../filter.ts";

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

describe("json path filter", () => {
  it("returns only selected fields", async () => {
    const result = await jqTransform(
      exampleResponse,
      "{ status: .status, data: { kind: .data.kind, items: [.data.items[] | { metadata: { name: .metadata.name } }] } }"
    );

    expect(result).toMatchSnapshot();
  });

  describe("returns original input data", () => {
    it("when no filter supplied", async () => {
      const result = await jqTransform(exampleResponse, undefined);

      expect(result).toMatchSnapshot();
    });
  });

  describe("fails instead of returning the original data", () => {
    it("on an invalid program", async () => {
      await expect(jqTransform(exampleResponse, "{ { }")).rejects.toThrow(
        /compile error/
      );
    });

    it("on a runtime error", async () => {
      await expect(
        jqTransform({ kind: "Status" }, "[.items[] | .name]")
      ).rejects.toThrow(/Cannot iterate over null/);
    });

    it("on an invalid program with a body larger than the pipe buffer", async () => {
      const data = { items: "x".repeat(5 * 1024 * 1024) };

      await expect(jqTransform(data, ".items[")).rejects.toThrow(
        /compile error/
      );
    });
  });

  describe("input limit", () => {
    const withLimit = async (
      value: string | undefined,
      run: () => Promise<void>
    ) => {
      const previous = process.env[JQ_MAX_INPUT_BYTES_ENV];
      if (value === undefined) delete process.env[JQ_MAX_INPUT_BYTES_ENV];
      else process.env[JQ_MAX_INPUT_BYTES_ENV] = value;
      try {
        await run();
      } finally {
        if (previous === undefined) delete process.env[JQ_MAX_INPUT_BYTES_ENV];
        else process.env[JQ_MAX_INPUT_BYTES_ENV] = previous;
      }
    };

    it("rejects an input larger than the limit without running jq", async () => {
      await withLimit("100", async () => {
        const data = { items: "x".repeat(101) };

        // `jq .` would succeed on this input, so only the limit can fail it
        await expect(jqTransform(data, ".")).rejects.toThrow(
          /larger than the jq input limit of 100 bytes/
        );
      });
    });

    it("accepts an input within the limit", async () => {
      await withLimit("1000", async () => {
        await expect(jqTransform({ a: 1 }, ".a")).resolves.toBe(1);
      });
    });

    it("does not limit the output", async () => {
      await withLimit("100", async () => {
        const result = await jqTransform(
          { n: 5 },
          '[range(.n)] | map("x" * 50)'
        );

        expect(result).toHaveLength(5);
      });
    });

    it.each(["abc", "0", "-5", "1.5"])(
      "falls back to the default for %s",
      async (value) => {
        await withLimit(value, async () => {
          await expect(jqTransform({ a: 1 }, ".a")).resolves.toBe(1);
        });
      }
    );
  });

  it("does not expose the client environment to the filter", async () => {
    process.env.BRAEKHUS_JQ_SENTINEL = "should-not-leak";
    try {
      const result = await jqTransform(
        { a: 1 },
        'env.BRAEKHUS_JQ_SENTINEL // "unset"'
      );
      expect(result).toBe("unset");
    } finally {
      delete process.env.BRAEKHUS_JQ_SENTINEL;
    }
  });
});
