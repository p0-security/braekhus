import { JsonRpcClient } from "../client";
import { runApp } from "../server";
import pinoLogger from "pino";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

const logger = pinoLogger({ name: "cli" });

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
        }),
    (args) => {
      runApp(args);
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
        tunnelHost: host,
        tunnelPort: port,
        insecure,
      } = args;
      const client = new JsonRpcClient(
        { targetUrl, clientId },
        { host, port, insecure }
      );
      logger.info({ args }, "Running JSON-RPC client");
      await client.run();
    }
  )
  .demandCommand(1)
  .strict()
  .parse();
