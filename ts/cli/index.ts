import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import { JsonRpcClient } from "../client";
import { JsonRpcApp, JsonRpcServer } from "../server";


void yargs(hideBin(process.argv))
  .command(
    "server <port>",
    "Start server",
    (yargs) =>
      yargs
        .positional("port", {
          type: "number",
          demandOption: true,
          describe: "The port where the server should listen for new connections",
        }),
    (args) => {
      const { port } = args;
      new JsonRpcApp(port);
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
        }),
    (args) => {
      const { host, port } = args;
      new JsonRpcClient(host, port);
    }
  )
  .demandCommand(1)
  .strict()
  .parse();
