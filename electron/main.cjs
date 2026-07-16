const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");

// All editor disk I/O is restricted to the project's content/ directory.
const CONTENT_DIR = path.join(app.getAppPath(), "content");

function safeContentPath(relPath) {
  const full = path.resolve(CONTENT_DIR, relPath);
  if (!full.startsWith(path.resolve(CONTENT_DIR))) {
    throw new Error("Path escapes content directory: " + relPath);
  }
  return full;
}

ipcMain.handle("content:read-all", () => {
  const out = {};
  const walk = (dir, prefix) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? prefix + "/" + entry.name : entry.name;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), rel);
      else if (entry.name.endsWith(".json")) {
        out[rel] = fs.readFileSync(path.join(dir, entry.name), "utf8");
      }
    }
  };
  walk(CONTENT_DIR, "");
  return out;
});

ipcMain.handle("content:write", (_ev, relPath, text) => {
  const full = safeContentPath(relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, text, "utf8");
  return true;
});

ipcMain.handle("content:delete", (_ev, relPath) => {
  const full = safeContentPath(relPath);
  if (fs.existsSync(full)) fs.unlinkSync(full);
  return true;
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 760,
    backgroundColor: "#0d0b14",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const devMode = process.argv.includes("--dev");
  if (devMode) {
    win.loadURL("http://localhost:5173");
  } else {
    win.loadFile(path.join(app.getAppPath(), "dist", "index.html"));
  }
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => app.quit());
