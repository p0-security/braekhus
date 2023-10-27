import { isArray } from "lodash";

import { createLogger } from "../log";

const logger = createLogger({ name: "filter" });

// import { jq } from "node-jq";
// TODO fix node config because jq-node cannot be imported with the `import` syntax above
// Error:
// Module '"node-jq"' has no exported member 'jq'.
const jq = require("node-jq");

export const jqTransform = async (
  data: any,
  jqHeader: string | string[] | undefined
): Promise<any> => {
  const query = isArray(jqHeader) ? jqHeader[0] : jqHeader;
  if (!query) {
    return data;
  }
  try {
    return await jq.run(query, data, { input: "json", output: "json" });
  } catch (error: any) {
    logger.error(
      { error, jpSelectQuery: query },
      "Error running jq query, ignoring filters"
    );
    return data;
  }
};
