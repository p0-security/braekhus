import fs from "node:fs/promises";
import path from "node:path";

import { createLogger } from "../log/index.ts";

const logger = createLogger({ name: "drop-root" });

// The Chainguard node image ships this user as nonroot. Customer volumes have
// no fsGroup, and an existing private key is root mode 0400, so the image
// still starts as root. The client hands the key directory to this user and
// then leaves root. An image that starts as this user stays off :latest.
const RUNTIME_UID = 65532;
const RUNTIME_GID = 65532;

/**
 * Chowns `jwkPath` to the runtime user and drops root. Returns whether the
 * process left root.
 *
 * No-op when the process is not root. Never throws: if the handoff or the
 * drop is refused, the process stays root and the refusal is logged.
 */
export const dropRootAfterKeyHandoff = async (jwkPath: string) => {
  if (process.getuid?.() !== 0) return false;
  try {
    await chownTree(jwkPath);
    dropRoot();
    return true;
  } catch (error) {
    // Some deployments cannot hand the key off: the directory is a read-only
    // Secret mount, or the container drops every capability. Those ran as root
    // on the previous image, so keep running rather than exit.
    logger.warn({ error }, "Could not drop root, continuing as root");
    return false;
  }
};

const dropRoot = () => {
  const { setgroups, setgid, setuid } = process;
  if (!setgroups || !setgid || !setuid) {
    throw new Error("Cannot drop root on this platform");
  }
  // Groups first. After setuid the process can no longer change them, and the
  // supplementary groups it started with include gid 0.
  setgroups([RUNTIME_GID]);
  setgid(RUNTIME_GID);
  setuid(RUNTIME_UID);
};

const chownTree = async (directory: string) => {
  // lstat, so a symlinked key path is refused instead of chowning its target.
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory()) {
    throw new Error(`JWK path is not a directory: ${directory}`);
  }
  await fs.chown(directory, RUNTIME_UID, RUNTIME_GID);
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const child = path.join(directory, entry.name);
    // Do not follow a symlink out of the volume. chown would change the target.
    if (entry.isSymbolicLink()) {
      await fs.lchown(child, RUNTIME_UID, RUNTIME_GID);
      continue;
    }
    if (entry.isDirectory()) {
      await chownTree(child);
      continue;
    }
    await fs.chown(child, RUNTIME_UID, RUNTIME_GID);
  }
};
