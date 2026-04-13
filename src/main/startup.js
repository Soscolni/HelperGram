/**
 * Windows startup registration — run HelperGram on boot
 */

import { app } from "electron";

export function setStartOnBoot(enabled) {
  app.setLoginItemSettings({
    openAtLogin: enabled,
    path: app.getPath("exe"),
  });
}

export function getStartOnBoot() {
  return app.getLoginItemSettings().openAtLogin;
}
