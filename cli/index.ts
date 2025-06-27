import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import { Backoff } from "../client/backoff.js";
import { JsonRpcClient } from "../client/index.js";
import { createLogger } from "../log/index.js";
import { runApp } from "../server/index.js";

const logger = createLogger({ name: "cli" });

void yargs(hideBin(process.argv))
  .command(
    "server",
    "Start server",
    (yargs) =>
      yargs
        .option("rpcPort", {
          type: "number",
          demandOption: true,
          describe:
            "The port where the server should listen for new RPC connections",
        })
        .option("proxyPort", {
          type: "number",
          demandOption: true,
          describe:
            "The port where the server should listen for incoming HTTP requests",
        })
        .option("proxyTimeout", {
          type: "number",
          demandOption: false,
          describe:
            "Timeout that is forwarded to the proxy client to use when requesting downstream resource",
        }),
    (args) => {
      runApp({
        appContext: args,
        forwardedRequestOptions: { timeoutMillis: args.proxyTimeout },
        retryOptions: { startMillis: 250, maxMillis: 2000, maxRetries: 5 },
      });
    }
  )
  .command(
    "client",
    "Start client",
    (yargs) =>
      yargs
        .option("targetUrl", {
          type: "string",
          demandOption: true,
          describe: "The URL to forward requests to",
        })
        .option("clientId", {
          type: "string",
          demandOption: true,
          describe: "The clientId used to identify this client",
        })
        .option("jwkPath", {
          type: "string",
          demandOption: true,
          describe:
            "The path to the directory on the file system where JWK is stored",
        })
        .option("tunnelHost", {
          type: "string",
          demandOption: true,
          describe: "The host to connect to via RPC",
        })
        .option("tunnelPort", {
          type: "number",
          demandOption: true,
          describe: "The port to connect to via RPC",
        })
        .option("insecure", {
          type: "boolean",
          alias: "k",
          describe: "If true, skips SSL",
        }),
    async (args) => {
      const {
        targetUrl,
        clientId,
        jwkPath,
        tunnelHost: host,
        tunnelPort: port,
        insecure,
      } = args;
      const backoff = new Backoff(1, 3000); // Aggressively retry starting at 1ms delay
      const client = new JsonRpcClient(
        { targetUrl, clientId, jwkPath },
        { host, port, insecure, backoff }
      );
      logger.info({ args }, "Running JSON-RPC client");
      await client.run();
    }
  )
  .demandCommand(1)
  .strict()
  .parse();
