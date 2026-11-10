import fs from "node:fs/promises";
import path from "node:path";

// The Chainguard node image ships this user as nonroot. Customer volumes have
// no fsGroup, and an existing private key is root mode 0400, so the image
// still starts as root. The client hands the key directory to this user and
// then leaves root. An image that starts as this user stays off :latest.
const RUNTIME_UID = 65532;
const RUNTIME_GID = 65532;

/**
 * Chowns `jwkPath` to the runtime user and drops root.
 *
 * No-op when the process is not root. Throws before dropping if the directory
 * cannot be handed off, so a failed chown does not leave the client unable
 * to read a key it just gave away.
 */
export const dropRootAfterKeyHandoff = async (jwkPath: string) => {
  if (process.getuid?.() !== 0) return false;
  await chownTree(jwkPath);
  const { setgid, setuid } = process;
  if (setgid === undefined || setuid === undefined) {
    throw new Error("Cannot drop root on this platform");
  }
  // setgid first. After setuid the process can no longer change its group.
  setgid(RUNTIME_GID);
  setuid(RUNTIME_UID);
  return true;
};

const chownTree = async (directory: string) => {
  const stat = await fs.stat(directory);
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
