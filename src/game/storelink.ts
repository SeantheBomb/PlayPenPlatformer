// "Wishlist on Steam" call to action — the owned funnel from every free build
// to the Steam page. Labels and URLs are content (game.json `store`), so the
// page URL can be filled in the editor the day the Coming Soon page goes live.
//
// Opening a link is a side effect OUTSIDE the simulation: it never touches
// game state, and replay drivers never open anything.
import type { GameConfig } from "../data/types";
import { PLATFORM } from "../platform";

export type StorePlacement = "pause" | "win" | "demo_end";

export interface StoreCta {
  label: string;
  url: string;
}

/** What the CTA should say and where it goes — or null when nothing is set. */
export function storeCta(store: GameConfig["store"] | undefined): StoreCta | null {
  if (!store) return null;
  if (store.steamUrl) return { label: store.wishlistLabel, url: store.steamUrl };
  // Before the Steam page exists: point at the fallback (e.g. Discord).
  if (store.fallbackUrl) return { label: store.fallbackLabel, url: store.fallbackUrl };
  return null;
}

/** Steam's UTM analytics attribute logged-in visits from these params (app
 *  pages only). Non-Steam URLs pass through untouched. */
export function withUtm(url: string, placement: StorePlacement, campaign: string): string {
  try {
    const u = new URL(url);
    if (!/(^|\.)steampowered\.com$/.test(u.hostname)) return url;
    u.searchParams.set("utm_source", `playpen-${PLATFORM}`);
    u.searchParams.set("utm_medium", placement);
    if (campaign) u.searchParams.set("utm_campaign", campaign);
    return u.toString();
  } catch {
    return url;
  }
}

/** Open in the system browser (Electron) or a new tab. Must be called from a
 *  real input event in the browser, or the popup blocker eats it. */
export function openExternal(url: string): void {
  try {
    if (window.playpenFS?.openExternal) {
      void window.playpenFS.openExternal(url);
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  } catch {
    // never let a link break play
  }
}
