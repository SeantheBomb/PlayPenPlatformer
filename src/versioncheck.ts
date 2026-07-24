// Detects a newer deploy while the tab stays open (Cloudflare Pages serves
// index.html uncached but a long-lived SPA tab never re-fetches it) and
// prompts to reload. Browser-only — Electron has no "deployed" build to
// diff against, it just runs whatever shipped in the package.
import { isElectron } from "./data/content";

const CHECK_INTERVAL_MS = 5 * 60 * 1000;

function mainScriptPath(html: string): string | null {
  const m = html.match(/<script[^>]+type=["']module["'][^>]+src=["']([^"']+)["']/i);
  return m ? m[1] : null;
}

function showReloadBanner(): void {
  if (document.getElementById("pp-update-banner")) return;
  const bar = document.createElement("div");
  bar.id = "pp-update-banner";
  bar.style.cssText = `
    position: fixed; top: 0; left: 0; right: 0; z-index: 9999;
    display: flex; align-items: center; justify-content: center; gap: 12px;
    padding: 10px 16px; background: #2a2140; color: #f0e6d2;
    font-family: "Segoe UI", system-ui, sans-serif; font-size: 14px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.4);
  `;
  bar.append(
    document.createTextNode("A new version of PlayPen is available.")
  );
  const btn = document.createElement("button");
  btn.textContent = "Reload";
  btn.style.cssText = `
    background: #ffd166; color: #2a2140; border: none; border-radius: 4px;
    padding: 4px 12px; font-weight: 600; cursor: pointer;
  `;
  btn.onclick = () => location.reload();
  bar.append(btn);
  document.body.append(bar);
}

async function checkOnce(currentPath: string): Promise<void> {
  try {
    const res = await fetch("/", { cache: "no-store" });
    if (!res.ok) return;
    const latestPath = mainScriptPath(await res.text());
    if (latestPath && latestPath !== currentPath) showReloadBanner();
  } catch {
    // Offline or transient network failure — try again on the next tick.
  }
}

export function startVersionCheck(): void {
  if (isElectron() || location.protocol === "file:" || import.meta.env.DEV) return;
  const currentPath = mainScriptPath(document.documentElement.outerHTML);
  if (!currentPath) return;
  setInterval(() => checkOnce(currentPath), CHECK_INTERVAL_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") checkOnce(currentPath);
  });
}
