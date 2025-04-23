import { jqTransform } from "../filter.js";
import { describe, expect,  it } from "vitest";

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
    it("on error", async () => {
      const result = await jqTransform(exampleResponse, "{ { }");

      expect(result).toMatchSnapshot();
    });

    it("when no filter supplied", async () => {
      const result = await jqTransform(exampleResponse, undefined);

      expect(result).toMatchSnapshot();
    });
  });
});
