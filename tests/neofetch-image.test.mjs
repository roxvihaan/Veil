import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const runFile = promisify(execFile);
const wrapper = fileURLToPath(new URL("../Neofetch/neofetch", import.meta.url));
const renderer = fileURLToPath(new URL("../bin/veil-image", import.meta.url));
const sampleImage = fileURLToPath(new URL("../assets/veil.icns", import.meta.url));

test("neofetch image persists a transparent-image ASCII default", async () => {
  const root = await mkdtemp(join(tmpdir(), "neofetch-image-"));
  const configDir = join(root, "neofetch");
  const configPath = join(configDir, "config.conf");
  const fakeNeofetch = join(root, "real-neofetch");
  const env = {
    ...process.env,
    XDG_CONFIG_HOME: root,
    NEOFETCH_REAL: fakeNeofetch,
    VEIL_IMAGE_RENDERER: renderer,
  };

  try {
    await writeFile(
      fakeNeofetch,
      [
        "#!/bin/sh",
        'if [ "${1:-}" = "--gen-config" ]; then',
        '  mkdir -p "$XDG_CONFIG_HOME/neofetch"',
        `  printf '%s\\n' 'image_backend="ascii"' 'image_source="auto"' 'ascii_bold="on"' > "$XDG_CONFIG_HOME/neofetch/config.conf"`,
        "  exit 1",
        "fi",
        "exit 0",
        "",
      ].join("\n"),
    );
    await chmod(fakeNeofetch, 0o755);

    await runFile(wrapper, ["image", sampleImage], { env });

    const [config, ascii] = await Promise.all([
      readFile(configPath, "utf8"),
      readFile(join(configDir, "veil-image-ascii.txt"), "utf8"),
    ]);
    assert.match(config, /image_backend="ascii"/);
    assert.match(config, new RegExp(`image_source="${join(configDir, "veil-image-ascii.txt")}"`));
    assert.match(config, /ascii_bold="off"/);
    assert.match(config, /ascii_colors=\((?:\d+ ){5}\d+\)/);
    assert.doesNotMatch(ascii, /\x1b\[/, "persisted Neofetch art must not contain ANSI bytes that break padding");
    assert.match(ascii, /\$\{c[1-6]\}/, "persisted art should use Neofetch color placeholders");
    assert.match(ascii, /[^\s]/, "persisted Neofetch art should contain visible detail");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
