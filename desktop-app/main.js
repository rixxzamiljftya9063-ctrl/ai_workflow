const { app, BrowserWindow, dialog, shell } = require("electron");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT_DIR = path.resolve(__dirname, "..");
const BACKEND_DIR = path.join(ROOT_DIR, "backend");
const FRONTEND_DIR = path.join(ROOT_DIR, "frontend");
const RUNTIME_DIR = path.join(ROOT_DIR, ".desktop-runtime");
const LOG_DIR = path.join(RUNTIME_DIR, "logs");
const BACKEND_PORT = Number(process.env.LINGGAILIU_BACKEND_PORT || 18000);
const FRONTEND_PORT = Number(process.env.LINGGAILIU_FRONTEND_PORT || 13000);
const BACKEND_URL = `http://127.0.0.1:${BACKEND_PORT}`;
const FRONTEND_URL = `http://127.0.0.1:${FRONTEND_PORT}`;

let mainWindow;
let backendProcess;
let frontendProcess;
let appLogStream;

function ensureDirs() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  appLogStream = fs.createWriteStream(path.join(LOG_DIR, "electron-app.log"), { flags: "a" });
}

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  if (appLogStream) appLogStream.write(line);
  console.log(message);
}

function commandExists(command) {
  const checker = process.platform === "win32" ? "where" : "which";
  return new Promise((resolve) => {
    const child = spawn(checker, [command], { shell: true, windowsHide: true });
    child.on("exit", (code) => resolve(code === 0));
    child.on("error", () => resolve(false));
  });
}

async function waitFor(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return true;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
  return false;
}

function spawnLogged(command, args, options, logName) {
  const logPath = path.join(LOG_DIR, logName);
  const logStream = fs.createWriteStream(logPath, { flags: "a" });
  logStream.write(`\n\n[${new Date().toISOString()}] ${command} ${args.join(" ")}\n`);
  const child = spawn(command, args, {
    ...options,
    shell: false,
    windowsHide: true
  });
  child.stdout.pipe(logStream);
  child.stderr.pipe(logStream);
  child.on("exit", (code, signal) => {
    log(`${logName} process exited: code=${code} signal=${signal || ""}`);
  });
  child.on("error", (error) => {
    log(`${logName} process error: ${error.message}`);
  });
  return child;
}

async function runOnce(command, args, cwd, logName) {
  return new Promise((resolve, reject) => {
    const child = spawnLogged(command, args, { cwd }, logName);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${code}. See ${path.join(LOG_DIR, logName)}`));
    });
    child.on("error", reject);
  });
}

async function ensureBackend() {
  const venvPython = path.join(BACKEND_DIR, ".venv", "Scripts", "python.exe");
  if (!fs.existsSync(venvPython)) {
    await runOnce("python", ["-m", "venv", ".venv"], BACKEND_DIR, "setup-backend.log");
  }
  await runOnce(venvPython, ["-m", "pip", "install", "-r", "requirements.txt"], BACKEND_DIR, "setup-backend.log");
  return venvPython;
}

async function ensureFrontend() {
  const nodeModules = path.join(FRONTEND_DIR, "node_modules");
  if (!fs.existsSync(nodeModules)) {
    await runOnce("npm.cmd", ["install"], FRONTEND_DIR, "setup-frontend.log");
  }
}

async function startBackend(pythonExe) {
  if (await waitFor(`${BACKEND_URL}/health`, 1500)) {
    log(`Backend already available at ${BACKEND_URL}`);
    return;
  }
  backendProcess = spawnLogged(
    pythonExe,
    ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", String(BACKEND_PORT)],
    {
      cwd: BACKEND_DIR,
      env: {
        ...process.env,
        BACKEND_PORT: String(BACKEND_PORT),
        DATABASE_URL: "sqlite:///./storage/ai_workflow.db",
        STORAGE_ROOT: "./storage",
        FRONTEND_ORIGIN: FRONTEND_URL
      }
    },
    "backend-electron.log"
  );
  if (!(await waitFor(`${BACKEND_URL}/health`, 45000))) {
    throw new Error(`Backend failed to start. See ${path.join(LOG_DIR, "backend-electron.log")}`);
  }
}

async function startFrontend() {
  if (await waitFor(FRONTEND_URL, 1500)) {
    log(`Frontend already available at ${FRONTEND_URL}`);
    return;
  }
  frontendProcess = spawnLogged(
    process.env.ComSpec || "cmd.exe",
    ["/d", "/s", "/c", "npm.cmd", "run", "dev", "--", "-H", "127.0.0.1", "-p", String(FRONTEND_PORT)],
    {
      cwd: FRONTEND_DIR,
      env: {
        ...process.env,
        NEXT_PUBLIC_API_BASE_URL: BACKEND_URL
      }
    },
    "frontend-electron.log"
  );
  if (!(await waitFor(FRONTEND_URL, 60000))) {
    throw new Error(`Frontend failed to start. See ${path.join(LOG_DIR, "frontend-electron.log")}`);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    title: "灵改流",
    backgroundColor: "#f8fafc",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, "splash.html"));

  mainWindow.webContents.on("render-process-gone", (_, details) => {
    log(`Renderer process gone: ${details.reason}`);
    dialog.showErrorBox("灵改流窗口异常", `窗口进程异常退出：${details.reason}\n\n日志目录：${LOG_DIR}`);
  });

  mainWindow.webContents.on("did-fail-load", (_, code, description, url) => {
    log(`Window failed to load ${url}: ${code} ${description}`);
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

async function boot() {
  ensureDirs();
  log("Booting Linggailiu desktop app");
  createWindow();
  try {
    if (!(await commandExists("python"))) throw new Error("Python was not found in PATH.");
    if (!(await commandExists("npm.cmd"))) throw new Error("Node.js/npm was not found in PATH.");
    const pythonExe = await ensureBackend();
    await ensureFrontend();
    await startBackend(pythonExe);
    await startFrontend();
    await mainWindow.loadURL(FRONTEND_URL);
    log(`Desktop window loaded ${FRONTEND_URL}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`Boot failed: ${message}`);
    dialog.showErrorBox("灵改流启动失败", `${message}\n\n日志目录：${LOG_DIR}`);
    app.quit();
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  app.whenReady().then(boot);
}

app.on("window-all-closed", () => {
  if (frontendProcess) frontendProcess.kill();
  if (backendProcess) backendProcess.kill();
  app.quit();
});

app.on("before-quit", () => {
  if (frontendProcess) frontendProcess.kill();
  if (backendProcess) backendProcess.kill();
  if (appLogStream) appLogStream.end();
});
