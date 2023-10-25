import { jpFilter as jqFilter } from "client/filter";

const exampleResponse = {
  headers: {
    "audit-id": "6a816d03-d29f-4657-b624-35766c8a5572",
    "cache-control": "no-cache, private",
    "content-type": "application/json",
    "x-kubernetes-pf-flowschema-uid": "ef7c3d21-4649-422d-a4fa-e5b85d52f141",
    "x-kubernetes-pf-prioritylevel-uid": "a6704cd4-c4fb-48bb-982e-a1ed79bfb12d",
    date: "Wed, 25 Oct 2023 06:08:30 GMT",
    "transfer-encoding": "chunked",
  },
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
          creationTimestamp: "2023-10-02T22:51:23Z",
          labels: {
            "kubernetes.io/bootstrapping": "rbac-defaults",
          },
          annotations: {
            "rbac.authorization.kubernetes.io/autoupdate": "true",
          },
          managedFields: [
            {
              manager: "clusterrole-aggregation-controller",
              operation: "Apply",
              apiVersion: "rbac.authorization.k8s.io/v1",
              time: "2023-10-02T22:51:38Z",
              fieldsType: "FieldsV1",
              fieldsV1: {
                "f:rules": {},
              },
            },
            {
              manager: "kube-apiserver",
              operation: "Update",
              apiVersion: "rbac.authorization.k8s.io/v1",
              time: "2023-10-02T22:51:23Z",
              fieldsType: "FieldsV1",
              fieldsV1: {
                "f:aggregationRule": {
                  ".": {},
                  "f:clusterRoleSelectors": {},
                },
                "f:metadata": {
                  "f:annotations": {
                    ".": {},
                    "f:rbac.authorization.kubernetes.io/autoupdate": {},
                  },
                  "f:labels": {
                    ".": {},
                    "f:kubernetes.io/bootstrapping": {},
                  },
                },
              },
            },
          ],
        },
      },
      {
        metadata: {
          name: "aws-node",
          uid: "63a3bed8-a750-440d-bca9-b5f41c8786c2",
          resourceVersion: "273",
          creationTimestamp: "2023-10-02T22:51:35Z",
          labels: {
            "app.kubernetes.io/instance": "aws-vpc-cni",
            "app.kubernetes.io/name": "aws-node",
            "app.kubernetes.io/version": "v1.12.6",
            "k8s-app": "aws-node",
          },
          annotations: {
            "kubectl.kubernetes.io/last-applied-configuration":
              '{"apiVersion":"rbac.authorization.k8s.io/v1","kind":"ClusterRole","metadata":{"annotations":{},"labels":{"app.kubernetes.io/instance":"aws-vpc-cni","app.kubernetes.io/name":"aws-node","app.kubernetes.io/version":"v1.12.6","k8s-app":"aws-node"},"name":"aws-node"},"rules":[{"apiGroups":["crd.k8s.amazonaws.com"],"resources":["eniconfigs"],"verbs":["list","watch","get"]},{"apiGroups":[""],"resources":["namespaces"],"verbs":["list","watch","get"]},{"apiGroups":[""],"resources":["pods"],"verbs":["list","watch","get"]},{"apiGroups":[""],"resources":["nodes"],"verbs":["list","watch","get","update"]},{"apiGroups":["extensions"],"resources":["*"],"verbs":["list","watch"]},{"apiGroups":["","events.k8s.io"],"resources":["events"],"verbs":["create","patch","list"]}]}\n',
          },
          managedFields: [
            {
              manager: "kubectl-client-side-apply",
              operation: "Update",
              apiVersion: "rbac.authorization.k8s.io/v1",
              time: "2023-10-02T22:51:35Z",
              fieldsType: "FieldsV1",
              fieldsV1: {
                "f:metadata": {
                  "f:annotations": {
                    ".": {},
                    "f:kubectl.kubernetes.io/last-applied-configuration": {},
                  },
                  "f:labels": {
                    ".": {},
                    "f:app.kubernetes.io/instance": {},
                    "f:app.kubernetes.io/name": {},
                    "f:app.kubernetes.io/version": {},
                    "f:k8s-app": {},
                  },
                },
                "f:rules": {},
              },
            },
          ],
        },
      },
    ],
  },
};

describe("json path filter", () => {
  it("returns only selected fields", async () => {
    const result = await jqFilter(
      exampleResponse,
      "{ headers: .headers, status: .status, statusText: .statusText, data: { kind: .data.kind, items: [.data.items[] | { metadata: { name: .metadata.name } }] } }"
    );

    expect(result).toMatchSnapshot();
  });
});
