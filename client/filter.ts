import { isArray } from "lodash-es";
import { run as jq } from "node-jq";

import { createLogger } from "../log/index.js";

const logger = createLogger({ name: "filter" });

export const jqTransform = async (
  data: any,
  jqHeader: string | string[] | undefined
): Promise<any> => {
  const query = isArray(jqHeader) ? jqHeader[0] : jqHeader;
  if (!query) {
    return data;
  }
  try {
    return await jq(query, data, { input: "json", output: "json" });
  } catch (error: any) {
    logger.error(
      { error, jpSelectQuery: query },
      "Error running jq query, ignoring filters"
    );
    return data;
  }
};
