/**
 * System tray management
 */

import { Tray, Menu, nativeImage } from "electron";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let tray = null;

export function createTray({ onSettings, onQuit }) {
  // Use a simple icon — try assets folder, fallback to default
  const iconPath = path.join(__dirname, "../../assets/icon.png");
  let icon;
  try {
    icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) throw new Error("empty");
  } catch {
    // Create a simple 16x16 colored square as fallback
    icon = nativeImage.createEmpty();
  }

  tray = new Tray(icon);
  tray.setToolTip("HelperGram");

  const contextMenu = Menu.buildFromTemplate([
    { label: "HelperGram is running", enabled: false },
    { type: "separator" },
    { label: "Settings", click: onSettings },
    { type: "separator" },
    { label: "Quit", click: onQuit },
  ]);

  tray.setContextMenu(contextMenu);
  return tray;
}

export function destroyTray() {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}
