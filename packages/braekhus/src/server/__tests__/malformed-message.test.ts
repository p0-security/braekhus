import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocket } from "ws";

import { JsonRpcServer } from "../index.ts";

const PORT = 18090;

const nextMessage = (ws: WebSocket) =>
  new Promise<any>((resolve) =>
    ws.once("message", (data) => resolve(JSON.parse(data.toString())))
  );

describe("JsonRpcServer receiving a malformed message", () => {
  let server: JsonRpcServer;
  let ws: WebSocket;

  beforeAll(async () => {
    server = new JsonRpcServer(
      { port: PORT },
      (_channelId, channel) => channel.addMethod("echo", (params) => params),
      () => {}
    );
    ws = new WebSocket(`ws://localhost:${PORT}`);
    await new Promise((resolve) => ws.once("open", resolve));
  });

  afterAll(() => {
    ws?.close();
    server?.shutdown();
  });

  // Vitest fails the run on an uncaught exception or unhandled rejection, which is what these messages caused
  it.each([
    ["text that is not JSON", "not json"],
    ["JSON that is not JSON-RPC", '{"foo":1}'],
    ["a JSON array of non-messages", "[1,2]"],
    ["JSON null", "null"],
  ])("keeps serving the channel after %s", async (_name, frame) => {
    ws.send(frame);
    const reply = nextMessage(ws);
    ws.send(
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "echo", params: [1] })
    );
    await expect(reply).resolves.toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: [1],
    });
  });
});
