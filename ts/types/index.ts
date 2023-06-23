export type Rule = {
  apiGroups: string[];
  resources: string[];
  verbs: string[];
};

export type Role = {
  kind: "Role";
  namespace: string;
};

export type ClusterRole = {
  kind: "ClusterRole";
};

export type Permission = {
  principal: string;
  name: string; // Name of the Role/ClusterRole to be granted to the principal
  rules?: Rule[]; // rules are optional: undefined means existing role, while if rules are specified it's a generated role
} & (Role | ClusterRole);

export type ClusterPermission = {
  clusterIds: string[];
  permission: Permission;
};
