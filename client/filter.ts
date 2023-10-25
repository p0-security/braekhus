import { isArray } from "lodash";

// jq-node doesn't support `import` syntax
const jq = require("node-jq");

export const jpFilter = async (
  data: any,
  jqHeader: string | string[] | undefined
): Promise<any> => {
  const jpSelectQuery = isArray(jqHeader) ? jqHeader[0] : jqHeader;
  if (!jpSelectQuery) {
    return data;
  }
  try {
    return await jq.run(jpSelectQuery, data, { input: "json", output: "json" });
  } catch (e: any) {
    console.log(e);
    return data;
  }
};
