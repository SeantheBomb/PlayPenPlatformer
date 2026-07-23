// AI-playtest helper: receives canvas PNG data-URLs POSTed from the running
// game (`canvas.toDataURL()`) and writes them to ./shots/ so they can be Read
// as images. Exists because the Browser-pane screenshot tool times out on
// this page, and a hidden/background tab won't render a fresh frame for a
// real screenshot anyway — Reading a PNG written straight from the canvas
// sidesteps both problems.
//
// Usage: node tools/dev-receiver.mjs
// From the page: fetch("http://localhost:5199/some_name", { method: "POST", body: canvas.toDataURL("image/png") })
//            or: fetch("http://localhost:5199/shot?name=some_name", { method: "POST", body: ... })
import http from "http";
import fs from "fs";
import path from "path";
import { URL } from "url";

const dir = path.join(process.cwd(), "shots");
fs.mkdirSync(dir, { recursive: true });

http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  if (req.method === "OPTIONS") { res.end(); return; }
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const url = new URL(req.url, "http://localhost");
    const raw = url.searchParams.get("name") || url.pathname.slice(1) || "shot";
    const name = raw.replace(/[^a-z0-9_-]/gi, "_") + ".png";
    const b64 = body.replace(/^data:image\/png;base64,/, "");
    fs.writeFileSync(path.join(dir, name), Buffer.from(b64, "base64"));
    console.log("saved", name);
    res.end("ok");
  });
}).listen(5199, () => console.log("dev-receiver on :5199, writing to", dir));
