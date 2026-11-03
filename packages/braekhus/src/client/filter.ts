import { isArray } from "lodash-es";
import { spawn } from "node:child_process";

import { DEFAULT_JQ_MAX_INPUT_BYTES } from "../common/constants.ts";
import { createLogger } from "../log/index.ts";

const logger = createLogger({ name: "filter" });

// node-jq only validated its own options and then spawned jq, and it pulls
// zod 3, which has no release that fixes GHSA-mrhx-c7xc-m3w5. The image
// already ships jq (JQ_PATH); call that binary instead.
const jqBinary = () => process.env.JQ_PATH ?? "jq";

export const JQ_MAX_INPUT_BYTES_ENV = "BRAEKHUS_JQ_MAX_INPUT_BYTES";

export const jqMaxInputBytes = () => {
  const value = process.env[JQ_MAX_INPUT_BYTES_ENV];
  if (value === undefined || value === "") return DEFAULT_JQ_MAX_INPUT_BYTES;
  const bytes = Number(value);
  if (!Number.isSafeInteger(bytes) || bytes <= 0) {
    logger.warn(
      { value },
      `${JQ_MAX_INPUT_BYTES_ENV} is not a positive integer, using the default`
    );
    return DEFAULT_JQ_MAX_INPUT_BYTES;
  }
  return bytes;
};

const runJq = (query: string, input: Buffer): Promise<unknown> =>
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
    child.stdin.end(input);
  });

export const jqProgram = (
  jqHeader: string | string[] | undefined
): string | undefined =>
  (isArray(jqHeader) ? jqHeader[0] : jqHeader) || undefined;

// Throws when the filter cannot be applied, so the request fails with a proxy
// error instead of returning a body the caller did not ask for. `body` is the
// raw response body: jq parses it itself, so it is not parsed or serialized
// here.
export const jqTransform = async (
  body: Buffer,
  query: string
): Promise<unknown> => {
  try {
    const maxBytes = jqMaxInputBytes();
    if (body.length > maxBytes) {
      throw new Error(
        `Response of ${body.length} bytes is larger than the jq input limit of ${maxBytes} bytes`
      );
    }
    return await runJq(query, body);
  } catch (error: any) {
    logger.error({ error, jpSelectQuery: query }, "Error running jq query");
    throw error;
  }
};

// Mirrors axios's default response handling for a body that was fetched raw:
// JSON when it parses, the text otherwise.
export const parseBody = (body: Buffer): unknown => {
  const text = body.toString("utf-8");
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};
