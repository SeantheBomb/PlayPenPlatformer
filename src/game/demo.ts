// Demo scope: the same slice serves the Steam demo app and (if Sean flips
// campaign.demo.onWeb) the free browser build. Which rooms are in the demo is
// content (campaign.json `demo`); this only decides whether THIS build plays
// as a demo.
import type { CampaignDef } from "../data/types";
import { PLATFORM } from "../platform";

/** `?demo` forces demo scope in a browser build — for testing the slice. */
function forcedByUrl(): boolean {
  try {
    return new URLSearchParams(location.search).has("demo");
  } catch {
    return false;
  }
}

export function isDemo(campaign: CampaignDef): boolean {
  const demo = campaign.demo;
  if (!demo || demo.rooms.length === 0) return false;
  if (PLATFORM === "steam-demo") return true;
  if (PLATFORM === "browser") return demo.onWeb || forcedByUrl();
  return false; // full Steam build and the desktop dev shell are never demos
}

/** Rooms a run can reach in this build, in campaign order. */
export function playableRooms(campaign: CampaignDef): string[] {
  if (!isDemo(campaign)) return campaign.rooms;
  const inDemo = new Set(campaign.demo!.rooms);
  return campaign.rooms.filter((id) => inDemo.has(id));
}
