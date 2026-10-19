// Which build of PlayPen is running. Every funnel number (telemetry, session
// replays, bug reports) carries this so browser, desktop and Steam players can
// be told apart once the Steam page and demo are live.
//
// The flavor is fixed at build time: `VITE_PLAYPEN_FLAVOR=steam npm run build`
// (or `steam-demo`). An unflavored build reports "electron" when it's running
// inside the desktop shell and "browser" otherwise.
import { isElectron } from "./data/content";

export type Platform = "browser" | "electron" | "steam" | "steam-demo";

function detect(): Platform {
  const flavor = import.meta.env.VITE_PLAYPEN_FLAVOR;
  if (flavor === "steam" || flavor === "steam-demo") return flavor;
  try {
    return isElectron() ? "electron" : "browser";
  } catch {
    return "browser";
  }
}

export const PLATFORM: Platform = detect();
