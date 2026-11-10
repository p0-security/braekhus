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

const mockRoot = () => {
  vi.spyOn(process, "getuid").mockReturnValue(0);
  return {
    setgroups: vi.spyOn(process, "setgroups").mockReturnValue(undefined),
    setgid: vi.spyOn(process, "setgid").mockReturnValue(undefined),
    setuid: vi.spyOn(process, "setuid").mockReturnValue(undefined),
  };
};

const refusal = (code: string) => Object.assign(new Error(code), { code });

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
    const { setgroups, setgid, setuid } = mockRoot();
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
    expect(setgroups).toHaveBeenCalledWith([65532]);
    expect(setgid).toHaveBeenCalledWith(65532);
    expect(setuid).toHaveBeenCalledWith(65532);
    const lastChown =
      chown.mock.invocationCallOrder[chown.mock.invocationCallOrder.length - 1];
    expect(lastChown).toBeLessThan(setgroups.mock.invocationCallOrder[0]);
    expect(setgroups.mock.invocationCallOrder[0]).toBeLessThan(
      setgid.mock.invocationCallOrder[0]
    );
    expect(setgid.mock.invocationCallOrder[0]).toBeLessThan(
      setuid.mock.invocationCallOrder[0]
    );
  });

  // EROFS is a read-only Secret mount. EPERM is a container with no CAP_CHOWN.
  it.each(["EROFS", "EPERM"])(
    "stays root when chown is refused with %s",
    async (code) => {
      const { setgroups, setgid, setuid } = mockRoot();
      vi.spyOn(fs, "chown").mockRejectedValue(refusal(code));
      const dir = await makeDir();

      await expect(dropRootAfterKeyHandoff(dir)).resolves.toBe(false);
      expect(setgroups).not.toHaveBeenCalled();
      expect(setgid).not.toHaveBeenCalled();
      expect(setuid).not.toHaveBeenCalled();
    }
  );

  it("stays root when the drop itself is refused", async () => {
    const { setgroups, setuid } = mockRoot();
    vi.spyOn(fs, "chown").mockResolvedValue(undefined);
    setgroups.mockImplementation(() => {
      throw refusal("EPERM");
    });
    const dir = await makeDir();

    await expect(dropRootAfterKeyHandoff(dir)).resolves.toBe(false);
    expect(setuid).not.toHaveBeenCalled();
  });

  it("stays root when the key directory is missing", async () => {
    const { setuid } = mockRoot();
    const chown = vi.spyOn(fs, "chown").mockResolvedValue(undefined);
    const missing = path.join(await makeDir(), "missing");

    await expect(dropRootAfterKeyHandoff(missing)).resolves.toBe(false);
    expect(chown).not.toHaveBeenCalled();
    expect(setuid).not.toHaveBeenCalled();
  });

  it("does not chown through a symlinked key path", async () => {
    const { setuid } = mockRoot();
    const chown = vi.spyOn(fs, "chown").mockResolvedValue(undefined);
    const target = await makeDir();
    const link = path.join(await makeDir(), "link");
    await fs.symlink(target, link);

    await expect(dropRootAfterKeyHandoff(link)).resolves.toBe(false);
    expect(chown).not.toHaveBeenCalled();
    expect(setuid).not.toHaveBeenCalled();
  });
});
