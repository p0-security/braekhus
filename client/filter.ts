import { createLogger } from "../log";
import { isArray } from "lodash";

const logger = createLogger({ name: "filter" });

// jq-node doesn't support `import` syntax
const jq = require("node-jq");

export const jpFilter = async (
  data: any,
  jqHeader: string | string[] | undefined
): Promise<any> => {
  const query = isArray(jqHeader) ? jqHeader[0] : jqHeader;
  if (!query) {
    return data;
  }
  try {
    // jq.run() returns a Promise
    return await jq.run(query, data, { input: "json", output: "json" });
  } catch (error: any) {
    logger.error(
      { error, jpSelectQuery: query },
      "Error running jq query, ignoring filters"
    );
    return data;
  }
};
