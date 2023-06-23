import { V1PolicyRule } from "@kubernetes/client-node";

export type Rule = {
  apiGroups: string[];
  resources: string[];
  resourceNames?: string[];
  verbs: string[];
};

export type Role = {
  kind: "Role";
  namespace: string;
};

export type ClusterRole = {
  kind: "ClusterRole";
};

// Pre-existing role request
export type K8sRole = {
  type: "role";
  roleName: string; // Name of the Role/ClusterRole to be granted to the principal
};

// Generated role request to grant access to the requested rules
export type K8sRules = {
  type: "rules";
  rules: V1PolicyRule[];
};

export type Permission = (K8sRole | K8sRules) & (Role | ClusterRole);

export type K8sPermission = {
  clusterIds: string[];
  principal: string;
  permission: Permission;
};

// JSON RPC types
export type Read = {
  name: string;
  namespace: string;
};

export type Create<T> = {
  namespace: string;
  body: T;
};

export type Replace<T> = {
  name: string;
  namespace: string;
  body: T;
};

export type Patch<T> = {
  name: string;
  namespace: string;
  body: Partial<T>;
};

export type Delete = {
  name: string;
  namespace: string;
};

// HTTP Bridge types
export type IndirectK8sApiResponse = {
  statusCode: number;
  statusMessage: string;
  body?: any;
};

export type ClusterRequest<T> = {
  clusterId: string;
  payload: T;
};
