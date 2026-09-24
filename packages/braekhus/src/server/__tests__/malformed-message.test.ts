import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";

import { JsonRpcServer } from "../index.ts";

const PORT = 18093;

const nextMessage = (ws: WebSocket) =>
  new Promise<any>((resolve) =>
    ws.once("message", (data) => resolve(JSON.parse(data.toString())))
  );

describe("JsonRpcServer receiving a malformed message", () => {
  let server: JsonRpcServer;
  let ws: WebSocket;
  let warn: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    // json-rpc-2.0 captures console.warn when the channel is constructed
    warn = vi.spyOn(console, "warn");
    server = new JsonRpcServer(
      { port: PORT },
      (_channelId, channel) => channel.addMethod("echo", (params) => params),
      () => {}
    );
    ws = new WebSocket(`ws://localhost:${PORT}`);
    await new Promise((resolve) => ws.once("open", resolve));
  });

  afterAll(() => {
    warn?.mockRestore();
    ws?.close();
    server?.shutdown();
  });

  // Vitest fails the run on an uncaught exception or unhandled rejection, which is what these messages caused
  it.each([
    ["text that is not JSON", "not json"],
    ["JSON that is not JSON-RPC", '{"foo":1}'],
    ["a JSON array of non-messages", "[1,2]"],
    ["JSON null", "null"],
    ["a JSON string", '"hello"'],
    ["a JSON number", "1"],
    ["a JSON boolean", "true"],
  ])("keeps serving the channel after %s", async (_name, frame) => {
    warn.mockClear();
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
    expect(warn).not.toHaveBeenCalled();
  });
});
