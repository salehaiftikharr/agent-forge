import { readFileSync } from "node:fs";
import { WEB_PID, WORKER_PID } from "./paths";

function kill(file: string) {
  try {
    const pid = Number(readFileSync(file, "utf8").trim());
    if (pid) process.kill(pid, "SIGTERM");
  } catch {
    /* already gone */
  }
}

/** Stop the worker and web server started in global-setup. */
export default async function globalTeardown() {
  kill(WORKER_PID);
  kill(WEB_PID);
}
