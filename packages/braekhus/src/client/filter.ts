import { isArray } from "lodash-es";
import { spawn } from "node:child_process";

import { createLogger } from "../log/index.ts";

const logger = createLogger({ name: "filter" });

// node-jq only validated its own options and then spawned jq, and it pulls
// zod 3, which has no release that fixes GHSA-mrhx-c7xc-m3w5. The image
// already ships jq (JQ_PATH); call that binary instead.
const jqBinary = () => process.env.JQ_PATH ?? "jq";

const runJq = (query: string, data: unknown): Promise<unknown> =>
  new Promise((resolve, reject) => {
    // node-jq spawned jq with an empty environment. The program comes from a
    // request header, so inheriting this process's environment would let a
    // filter read it.
    const child = spawn(jqBinary(), [query], { env: {} });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.stdin.on("error", (error) => {
      // jq exits before reading stdin when the program is invalid. Without
      // this listener Node raises an unhandled EPIPE and the client dies.
      // The close handler reports the failure.
      logger.error({ error, jpSelectQuery: query }, "jq stdin error");
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      if (code !== 0) {
        reject(
          new Error(Buffer.concat(stderr).toString() || `jq exited ${code}`)
        );
        return;
      }
      const text = Buffer.concat(stdout).toString().replace(/\n$/, "");
      try {
        resolve(JSON.parse(text));
      } catch {
        // A filter can print more than one value, or none. That is still the
        // program's output, so return the text instead of failing the request.
        resolve(text);
      }
    });
    child.stdin.end(JSON.stringify(data));
  });

// Throws when the filter cannot be applied, so the caller never gets a body it
// did not ask for. The client turns the error into a 502 response.
export const jqTransform = async (
  data: any,
  jqHeader: string | string[] | undefined
): Promise<any> => {
  const query = isArray(jqHeader) ? jqHeader[0] : jqHeader;
  if (!query) return data;
  try {
    return await runJq(query, data);
  } catch (error: any) {
    logger.error({ error, jpSelectQuery: query }, "Error running jq query");
    throw error;
  }
};
