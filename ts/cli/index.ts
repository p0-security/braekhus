import { JsonRpcClient } from "../client";
import { JsonRpcApp } from "../server";
import { httpBridgeApp } from "../server/bridge";
import pinoLogger from "pino";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

const logger = pinoLogger({ name: "cli" });

void yargs(hideBin(process.argv))
  .command(
    "server <rpcPort> <bridgePort>",
    "Start server",
    (yargs) =>
      yargs
        .positional("rpcPort", {
          type: "number",
          demandOption: true,
          describe:
            "The port where the server should listen for new RPC connections",
        })
        .positional("bridgePort", {
          type: "number",
          demandOption: true,
          describe:
            "The port where the server should listen for permission requests",
        }),
    (args) => {
      const { rpcPort, bridgePort } = args;
      const jsonRpcApp = new JsonRpcApp(rpcPort);
      const app = httpBridgeApp(jsonRpcApp.getRpcServer());
      app.listen(bridgePort, () => {
        logger.info(`HTTP Bridge app listening on port ${bridgePort}`);
      });
    }
  )
  .command(
    "client <host> <port>",
    "Start client",
    (yargs) =>
      yargs
        .positional("host", {
          type: "string",
          demandOption: true,
          describe: "The host to connect to",
        })
        .positional("port", {
          type: "number",
          demandOption: true,
          describe: "The port to connect to",
        })
        .option("insecure", {
          type: "boolean",
          alias: "k",
          describe: "If true, skips SSL",
        }),
    async (args) => {
      const { host, port } = args;
      const client = new JsonRpcClient(host, port, args);
      logger.info("RUN");
      await client.run();
    }
  )
  .demandCommand(1)
  .strict()
  .parse();
