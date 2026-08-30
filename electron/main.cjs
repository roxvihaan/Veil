const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const pty = require("node-pty");

let nativeBlur;
for (const candidate of [
  path.join(__dirname, "..", "native", "veil_blur.node"),
  path.join(__dirname, "..", "native", "build", "veil_blur.node"),
]) {
  try {
    nativeBlur = require(candidate);
    break;
  } catch {
    // The native helper is built during macOS packaging. Electron vibrancy is
    // retained below only as a compatibility fallback.
  }
}

const isMac = process.platform === "darwin";
const configRoot = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
const configDir = path.join(configRoot, "veil");
const configPath = path.join(configDir, "config");
const sessions = new Map();
const pendingOpenRequests = [];
let mainWindow;
let configWatcher;
let rendererHasTerminal = false;

app.setName("Veil Terminal");

const defaultConfig = `# config
# Reloads when saved.

font-family = "JetBrains Mono, SFMono-Regular, Menlo, monospace"
font-size = 14
font-weight = 450
line-height = 1.18
shell = "${process.env.SHELL || (isMac ? "/bin/zsh" : "/bin/bash")}"
cursor-style = "block"
cursor-blink = true
transparent = true
clear-mode = false
glass-mode = "liquid"
glass-opacity = 0
glass-blur = 28
panel-opacity = 0.28
padding-x = 18
padding-y = 16
foreground = "#eef3ea"
background = "#080c0c"
accent = "#79f26f"
border = "#c7826d"
selection = "#5f745f88"
black = "#1d2422"
red = "#f08c86"
green = "#79f26f"
yellow = "#e8cb78"
blue = "#86aee8"
magenta = "#dba1e8"
cyan = "#7ed3c4"
white = "#eef3ea"
`;

function parseValue(value) {
  const raw = value.trim();
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1);
  }
  if (raw === "true") return true;
  if (raw === "false") return false;
  const number = Number(raw);
  return Number.isNaN(number) ? raw : number;
}

function readConfig() {
  try {
    fs.mkdirSync(configDir, { recursive: true });
    if (!fs.existsSync(configPath)) fs.writeFileSync(configPath, defaultConfig, "utf8");
    const config = {};
    for (const line of fs.readFileSync(configPath, "utf8").split(/\r?\n/)) {
      const clean = line.trim();
      if (!clean || clean.startsWith("#")) continue;
      const separator = clean.indexOf("=");
      if (separator === -1) continue;
      config[clean.slice(0, separator).trim()] = parseValue(clean.slice(separator + 1));
    }
    // Frosted/`veil trans` was removed. Treat an existing Frosted config as
    // Liquid so older config files continue to open in a supported mode.
    if (config["glass-mode"] === "frost") {
      config["glass-mode"] = "liquid";
      config["clear-mode"] = false;
      config["glass-blur"] = 28;
    }
    return { ...config, configPath };
  } catch (error) {
    return { configPath, error: error.message };
  }
}

function writeConfigValue(key, value) {
  readConfig();
  const serialized = typeof value === "string" ? `"${value.replaceAll('"', '\\"')}"` : String(value);
  const lines = fs.readFileSync(configPath, "utf8").split(/\r?\n/);
  const index = lines.findIndex((line) => line.trim().startsWith(`${key} =`));
  if (index === -1) lines.push(`${key} = ${serialized}`);
  else lines[index] = `${key} = ${serialized}`;
  fs.writeFileSync(configPath, `${lines.join("\n").replace(/\n+$/, "")}\n`, "utf8");
  const config = readConfig();
  applyWindowEffects(config);
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("config:changed", config);
  return config;
}

function applyWindowEffects(config) {
  if (!mainWindow || mainWindow.isDestroyed() || !isMac) return;
  const mode = config["glass-mode"] || (config["clear-mode"] === true ? "clear" : "liquid");
  const clearMax = mode === "clear" && Number(config["glass-opacity"]) <= 0;
  const nativeGlass = config.transparent !== false && mode === "liquid";
  const blurRadius = nativeGlass ? Math.max(1, Number(config["glass-blur"]) || 28) : 0;

  // Liquid is the exact same transparent Chromium surface as Clear. A small
  // native helper applies only WindowServer background blur, avoiding the
  // gray/white tint that every NSVisualEffectView vibrancy material adds.
  mainWindow.setVibrancy(null, { animationDuration: 0 });
  let tintlessBlurApplied = false;
  try {
    tintlessBlurApplied = nativeBlur?.apply(mainWindow.getNativeWindowHandle(), blurRadius) === true;
  } catch (error) {
    console.error("Native background blur failed:", error);
  }
  if (nativeGlass && !tintlessBlurApplied) {
    mainWindow.setVibrancy("under-window", { animationDuration: 0 });
  }
  mainWindow.setHasShadow(!clearMax);
}

function watchConfig() {
  if (configWatcher) configWatcher.close();
  try {
    configWatcher = fs.watch(configPath, { persistent: false }, () => {
      clearTimeout(watchConfig.timer);
      watchConfig.timer = setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          const config = readConfig();
          applyWindowEffects(config);
          mainWindow.webContents.send("config:changed", config);
        }
      }, 20);
    });
  } catch {
    // The config will still be reloaded on the next app launch.
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 720,
    minWidth: 620,
    minHeight: 420,
    transparent: true,
    backgroundColor: "#00000000",
    visualEffectState: isMac ? "active" : undefined,
    titleBarStyle: isMac ? "hiddenInset" : "hidden",
    trafficLightPosition: isMac ? { x: 16, y: 17 } : undefined,
    roundedCorners: true,
    hasShadow: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "client", "index.html"));
  }

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    applyWindowEffects(readConfig());
    mainWindow.focus();
  });
  mainWindow.webContents.on("preload-error", (_event, preloadPath, error) => {
    console.error(`Preload failed: ${preloadPath}`, error);
  });
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error("Renderer process ended:", details);
  });
  mainWindow.webContents.on("did-fail-load", (_event, code, description, url) => {
    console.error(`Renderer failed to load (${code}): ${description} — ${url}`);
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
    rendererHasTerminal = false;
  });
  watchConfig();
}

function terminalFor(event, id) {
  const entry = sessions.get(id);
  if (!entry || entry.owner !== event.sender.id) return null;
  return entry.terminal;
}

function loginShellArgs(shellPath) {
  const shellName = path.basename(shellPath);
  if (shellName === "fish") return ["--login"];
  if (["zsh", "bash", "sh", "ksh"].includes(shellName)) return ["-l"];
  return [];
}

function accountShell() {
  const candidates = [];
  try { candidates.push(os.userInfo().shell); } catch { /* use fallbacks */ }
  candidates.push(process.env.SHELL, isMac ? "/bin/zsh" : "/bin/bash");
  for (const shellPath of candidates) {
    if (!shellPath) continue;
    try {
      fs.accessSync(shellPath, fs.constants.X_OK);
      return shellPath;
    } catch {
      // Try the next account/platform shell.
    }
  }
  throw new Error("No executable login shell was found.");
}

function resolveShell(configuredShell) {
  if (typeof configuredShell === "string" && configuredShell) {
    try {
      fs.accessSync(configuredShell, fs.constants.X_OK);
      return configuredShell;
    } catch {
      console.warn(`Configured shell is not executable: ${configuredShell}; using the account shell.`);
    }
  }
  return accountShell();
}

function terminalPath() {
  const home = os.homedir();
  const candidates = [
    path.join(__dirname, "..", "bin"),
    path.join(home, ".local", "bin"),
    path.join(home, "bin"),
    path.join(home, ".cargo", "bin"),
    path.join(home, ".bun", "bin"),
    path.join(home, ".deno", "bin"),
    path.join(home, ".volta", "bin"),
    path.join(home, ".pyenv", "bin"),
    path.join(home, ".npm-global", "bin"),
    "/opt/homebrew/bin",
    "/opt/homebrew/sbin",
    "/usr/local/bin",
    "/usr/local/sbin",
    "/opt/local/bin",
    "/opt/local/sbin",
    "/Applications/Docker.app/Contents/Resources/bin",
    ...(process.env.PATH || "").split(path.delimiter),
  ];
  return [...new Set(candidates.filter(Boolean))].join(path.delimiter);
}

function terminalEnvironment(shellPath, sessionId) {
  let user = {};
  try { user = os.userInfo(); } catch { /* environment fallbacks below */ }
  const home = user.homedir || os.homedir();
  const username = user.username || process.env.USER || process.env.LOGNAME || "user";
  return {
    ...process.env,
    HOME: home,
    USER: username,
    LOGNAME: username,
    SHELL: shellPath,
    PATH: terminalPath(),
    PWD: home,
    LANG: process.env.LANG || "en_US.UTF-8",
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    TERM_PROGRAM: "Veil",
    TERM_PROGRAM_VERSION: app.getVersion(),
    TERM_SESSION_ID: `Veil-${sessionId}`,
    CLICOLOR: process.env.CLICOLOR || "1",
  };
}

function openDirectoryFor(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  let candidate = value.trim();
  if (candidate.startsWith("file:")) {
    try { candidate = require("node:url").fileURLToPath(candidate); } catch { return null; }
  }
  candidate = path.resolve(candidate);
  try {
    const stats = fs.statSync(candidate);
    return stats.isDirectory() ? candidate : path.dirname(candidate);
  } catch {
    return null;
  }
}

function openRequestFor(value, editFile = false) {
  if (typeof value !== "string" || !value.trim()) return null;
  let candidate = value.trim();
  if (candidate.startsWith("file:")) {
    try { candidate = require("node:url").fileURLToPath(candidate); } catch { return null; }
  }
  candidate = path.resolve(candidate);
  try {
    const stats = fs.statSync(candidate);
    if (stats.isDirectory()) return { cwd: candidate, filePath: null };
    if (stats.isFile()) return { cwd: path.dirname(candidate), filePath: editFile ? candidate : null };
  } catch {
    return null;
  }
  return null;
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

function requestOpenTarget(value, editFile = false) {
  const request = openRequestFor(value, editFile);
  if (!request) return false;
  pendingOpenRequests.push(request);
  if (rendererHasTerminal && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.sendInputEvent({ type: "keyDown", keyCode: "T", modifiers: ["meta"] });
    mainWindow.webContents.sendInputEvent({ type: "keyUp", keyCode: "T", modifiers: ["meta"] });
  }
  return true;
}

function directoryFromVeilUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "veil:") return null;
    return parsed.searchParams.get("path") || decodeURIComponent(parsed.pathname.replace(/^\/+/, "/"));
  } catch {
    return null;
  }
}

for (let index = 0; index < process.argv.length; index += 1) {
  const argument = process.argv[index];
  if (argument === "--working-directory") requestOpenTarget(process.argv[index + 1]);
  else if (argument.startsWith("--working-directory=")) requestOpenTarget(argument.slice("--working-directory=".length));
}

app.on("open-file", (event, filePath) => {
  event.preventDefault();
  requestOpenTarget(filePath, true);
});
app.on("open-url", (event, rawUrl) => {
  event.preventDefault();
  requestOpenTarget(directoryFromVeilUrl(rawUrl), true);
});

ipcMain.handle("config:get", () => readConfig());
ipcMain.handle("config:set", (_event, { key, value }) => {
  const allowed = new Set(["transparent"]);
  if (!allowed.has(key)) throw new Error(`Unsupported config key: ${key}`);
  return writeConfigValue(key, value);
});
ipcMain.handle("config:open", async () => {
  readConfig();
  const result = await shell.openPath(configPath);
  return { ok: !result, error: result || null, configPath };
});

ipcMain.handle("terminal:create", (event, options = {}) => {
  const config = readConfig();
  const shellPath = resolveShell(config.shell);
  const pendingRequest = pendingOpenRequests.shift();
  const cwd = openDirectoryFor(options.cwd) || pendingRequest?.cwd || os.homedir();
  const id = `${event.sender.id}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  const terminal = pty.spawn(shellPath, loginShellArgs(shellPath), {
    name: "xterm-256color",
    cols: Math.max(2, options.cols || 80),
    rows: Math.max(1, options.rows || 24),
    cwd,
    env: terminalEnvironment(shellPath, id),
  });

  sessions.set(id, { terminal, owner: event.sender.id });
  rendererHasTerminal = true;
  const sender = event.sender;
  const sendToRenderer = (channel, payload) => {
    if (!sender.isDestroyed()) sender.send(channel, payload);
  };
  let pendingOutput = "";
  let outputTimer = null;
  const flushOutput = () => {
    outputTimer = null;
    if (!pendingOutput) return;
    const data = pendingOutput;
    pendingOutput = "";
    sendToRenderer("terminal:data", { id, data });
  };
  terminal.onData((data) => {
    pendingOutput += data;
    if (pendingOutput.length >= 65536) {
      if (outputTimer) clearTimeout(outputTimer);
      flushOutput();
      return;
    }
    if (!outputTimer) outputTimer = setTimeout(flushOutput, 4);
  });
  terminal.onExit(({ exitCode, signal }) => {
    if (outputTimer) clearTimeout(outputTimer);
    flushOutput();
    sendToRenderer("terminal:exit", { id, exitCode, signal });
    sessions.delete(id);
  });
  if (pendingRequest?.filePath) {
    // Keep the login shell alive so quitting Vim returns to a normal terminal.
    // PTYs safely buffer this brief command while shell startup files finish.
    setTimeout(() => {
      if (!sessions.has(id)) return;
      terminal.write(`command vim -- ${shellQuote(pendingRequest.filePath)}\r`);
    }, 20);
  }
  sender.once("destroyed", () => {
    if (outputTimer) clearTimeout(outputTimer);
    const entry = sessions.get(id);
    if (!entry) return;
    sessions.delete(id);
    try { entry.terminal.kill(); } catch { /* terminal already exited */ }
  });

  return { id, shell: path.basename(shellPath), cwd };
});

ipcMain.on("terminal:write", (event, { id, data }) => terminalFor(event, id)?.write(data));
ipcMain.on("terminal:resize", (event, { id, cols, rows }) => {
  if (cols > 1 && rows > 0) terminalFor(event, id)?.resize(cols, rows);
});
ipcMain.on("terminal:close", (event, id) => {
  terminalFor(event, id)?.kill();
  sessions.delete(id);
});

app.whenReady().then(createWindow);
app.on("window-all-closed", () => {
  if (!isMac) app.quit();
});
app.on("activate", () => {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
});
app.on("before-quit", () => {
  for (const { terminal } of sessions.values()) terminal.kill();
  sessions.clear();
  configWatcher?.close();
});
