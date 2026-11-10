import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { dropRootAfterKeyHandoff } from "../drop-root.ts";

const dirs: string[] = [];

const makeDir = async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "braekhus-drop-"));
  dirs.push(dir);
  return dir;
};

describe("dropRootAfterKeyHandoff", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(
      dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true }))
    );
  });

  it("does nothing when the process is not root", async () => {
    vi.spyOn(process, "getuid").mockReturnValue(1000);
    const setuid = vi.spyOn(process, "setuid");
    const dir = await makeDir();

    await expect(dropRootAfterKeyHandoff(dir)).resolves.toBe(false);
    expect(setuid).not.toHaveBeenCalled();
  });

  it("chowns the directory and its files before dropping root", async () => {
    vi.spyOn(process, "getuid").mockReturnValue(0);
    const setgid = vi
      .spyOn(process, "setgid")
      .mockImplementation(() => undefined);
    const setuid = vi
      .spyOn(process, "setuid")
      .mockImplementation(() => undefined);
    const chown = vi.spyOn(fs, "chown").mockResolvedValue(undefined);
    const lchown = vi.spyOn(fs, "lchown").mockResolvedValue(undefined);
    const dir = await makeDir();
    const outsideDir = await makeDir();
    const key = path.join(dir, "jwk.private.json");
    const nested = path.join(dir, "nested");
    const outside = path.join(outsideDir, "target");
    await fs.writeFile(key, "secret");
    await fs.chmod(key, 0o400);
    await fs.mkdir(nested);
    await fs.writeFile(path.join(nested, "ca.pem"), "cert");
    await fs.writeFile(outside, "leave-me");
    await fs.symlink(outside, path.join(dir, "link"));

    await expect(dropRootAfterKeyHandoff(dir)).resolves.toBe(true);

    expect(chown).toHaveBeenCalledWith(dir, 65532, 65532);
    expect(chown).toHaveBeenCalledWith(key, 65532, 65532);
    expect(chown).toHaveBeenCalledWith(nested, 65532, 65532);
    expect(chown).toHaveBeenCalledWith(
      path.join(nested, "ca.pem"),
      65532,
      65532
    );
    expect(chown).not.toHaveBeenCalledWith(outside, 65532, 65532);
    expect(lchown).toHaveBeenCalledWith(path.join(dir, "link"), 65532, 65532);
    expect(setgid).toHaveBeenCalledWith(65532);
    expect(setuid).toHaveBeenCalledWith(65532);
    const lastChown =
      chown.mock.invocationCallOrder[chown.mock.invocationCallOrder.length - 1];
    expect(lastChown).toBeLessThan(setgid.mock.invocationCallOrder[0]);
    expect(setgid.mock.invocationCallOrder[0]).toBeLessThan(
      setuid.mock.invocationCallOrder[0]
    );
  });

  it("does not drop root when the key directory cannot be handed off", async () => {
    vi.spyOn(process, "getuid").mockReturnValue(0);
    const setuid = vi.spyOn(process, "setuid");
    const missing = path.join(os.tmpdir(), "braekhus-drop-missing");

    await expect(dropRootAfterKeyHandoff(missing)).rejects.toThrow();
    expect(setuid).not.toHaveBeenCalled();
  });
});
