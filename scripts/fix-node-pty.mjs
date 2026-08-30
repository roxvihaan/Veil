import { chmod, readdir } from "node:fs/promises";
import { join } from "node:path";

const prebuilds = join(process.cwd(), "node_modules", "node-pty", "prebuilds");

try {
  for (const platform of await readdir(prebuilds)) {
    if (!platform.startsWith("darwin-")) continue;
    try {
      await chmod(join(prebuilds, platform, "spawn-helper"), 0o755);
    } catch {
      // A prebuild for another architecture may not include the helper.
    }
  }
} catch {
  // node-pty may not be installed yet.
}
