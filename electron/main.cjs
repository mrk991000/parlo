const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  ipcMain,
  safeStorage,
  shell,
  globalShortcut,
  clipboard,
} = require("electron");
const path = require("path");
const fs = require("fs");

const iconPath = path.join(__dirname, "icon.png");
const HOTKEY = "CommandOrControl+Shift+Space";
const startHidden = process.argv.includes("--hidden");

let win = null;
let tray = null;
let quitting = false;

function createWindow() {
  win = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 600,
    minHeight: 400,
    backgroundColor: "#212121",
    autoHideMenuBar: true,
    icon: iconPath,
    show: !startHidden,
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http")) shell.openExternal(url);
    return { action: "deny" };
  });

  if (app.isPackaged) {
    win.loadFile(path.join(__dirname, "../dist/index.html"));
  } else {
    win.loadURL("http://localhost:5173");
  }

  win.on("close", (e) => {
    if (!quitting) {
      e.preventDefault();
      win.hide();
    }
  });
}

function showWindow() {
  if (!win) createWindow();
  win.show();
  win.focus();
}

// open the app and offer the clipboard text to the page
async function quickAsk() {
  let clip = "";

  try {
    clip = String((await clipboard.readText()) ?? "").slice(0, 20000);
  } catch {}

  showWindow();
  win.webContents.send("quick:ask", { clip });
}

function createTray() {
  const img = nativeImage
    .createFromPath(iconPath)
    .resize({ width: 16, height: 16 });
  tray = new Tray(img);
  tray.setToolTip("Parlo");

  const items = [
    { label: "Open Parlo", click: showWindow },
    { label: "Quick ask (Ctrl+Shift+Space)", click: quickAsk },
  ];

  // "start when I log in" only makes sense in the installed app
  if (app.isPackaged && process.platform !== "linux") {
    items.push({
      label: "Start when I log in",
      type: "checkbox",
      checked: app.getLoginItemSettings({ args: ["--hidden"] }).openAtLogin,
      click: (item) =>
        app.setLoginItemSettings({
          openAtLogin: item.checked,
          args: ["--hidden"],
        }),
    });
  }

  items.push(
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        quitting = true;
        app.quit();
      },
    },
  );

  tray.setContextMenu(Menu.buildFromTemplate(items));
  tray.on("click", showWindow);
}

// ---------- API key ----------
const keyFile = () => path.join(app.getPath("userData"), "key.bin");

function readKey() {
  try {
    return safeStorage.decryptString(fs.readFileSync(keyFile()));
  } catch {
    return null;
  }
}

ipcMain.handle("key:has", () => !!readKey());

ipcMain.handle("key:set", (_e, key) => {
  fs.writeFileSync(keyFile(), safeStorage.encryptString(key.trim()));
  return true;
});

// ---------- Chat ----------
const MODELS = [
  "claude-sonnet-5-5",
  "claude-opus-5-5",
  "claude-haiku-4-5-20251001",
];
const controllers = new Map(); // requestId -> AbortController

ipcMain.handle("chat:send", async (event, { requestId, messages, model }) => {
  const key = readKey();
  if (!key) return { error: "No API key set." };

  const controller = new AbortController();
  controllers.set(requestId, controller);
  const usage = { input: 0, output: 0 };

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODELS.includes(model) ? model : MODELS[0],
        max_tokens: 4096,
        stream: true,
        messages,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return { error: err.error?.message || `Request failed (${res.status})` };
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        try {
          const ev = JSON.parse(line.slice(6));
          if (ev.type === "message_start") {
            usage.input = ev.message?.usage?.input_tokens ?? 0;
          } else if (ev.type === "message_delta") {
            usage.output = ev.usage?.output_tokens ?? usage.output;
          } else if (
            ev.type === "content_block_delta" &&
            ev.delta?.type === "text_delta"
          ) {
            event.sender.send("chat:chunk", { requestId, text: ev.delta.text });
          }
        } catch {
          // ignore partial lines
        }
      }
    }
    return { ok: true, usage };
  } catch (err) {
    if (err.name === "AbortError") return { stopped: true, usage };
    return { error: err.message };
  } finally {
    controllers.delete(requestId);
  }
});

ipcMain.handle("chat:stop", (_e, requestId) => {
  if (requestId) controllers.get(requestId)?.abort();
  else controllers.forEach((c) => c.abort());
  return true;
});

// ---------- App lifecycle ----------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", showWindow);
  app.whenReady().then(() => {
    createWindow();
    createTray();
    if (!globalShortcut.register(HOTKEY, quickAsk)) {
      console.warn("Could not register hotkey (another app may be using it)");
    }
  });
}

app.on("before-quit", () => {
  quitting = true;
});
app.on("will-quit", () => globalShortcut.unregisterAll());
app.on("window-all-closed", () => {});
