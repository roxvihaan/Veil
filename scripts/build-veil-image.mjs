import { chmod, copyFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

if (process.platform !== "darwin") process.exit(0);

const root = process.cwd();
const buildDirectory = join(root, "native", "build");
const output = join(buildDirectory, "veil-image");
const bundledOutput = join(root, "release", "Veil Terminal.app", "Contents", "Resources", "app", "bin", "veil-image");

await mkdir(buildDirectory, { recursive: true });

const result = spawnSync("xcrun", [
  "clang",
  "-fobjc-arc",
  "-mmacosx-version-min=12.0",
  "-framework", "AppKit",
  "-framework", "CoreGraphics",
  join(root, "native", "veil_image.m"),
  "-o", output,
], { stdio: "inherit" });

if (result.status !== 0) process.exit(result.status || 1);

await copyFile(output, join(root, "bin", "veil-image"));
await copyFile(output, bundledOutput);
await Promise.all([
  chmod(join(root, "bin", "veil-image"), 0o755),
  chmod(bundledOutput, 0o755),
]);

console.log(`Created ${output}`);
