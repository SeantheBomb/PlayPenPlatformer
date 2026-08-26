// Quest Builder — a pop-out modal for full NPC editing (character identity,
// dialog, quest/rewards, spawn gating). Replaces the old inline sidebar
// blocks that squeezed everything into the 250px inspector column. Position,
// sprite/portrait upload, and the generic duplicate/delete-entity buttons
// stay on the sidebar row that opens this — same "everything else stays
// where it is" split as the pixel editor pop-out.
import type { Content, NpcAvatar, RoomEntity } from "../data/types";
import { drawNpcAvatar } from "../engine/renderer";
import { tileProgress, entityProgress, enemyProgress } from "../game/roomProgress";
import { emptyRoomMutations } from "../game/state";
import { allNpcIds, el } from "./forms";

const AVATARS: NpcAvatar[] = ["blocky", "scribble", "plush", "trophy", "windup"];
const ENTITY_PROGRESS_TYPES = [
  "spawn", "checkpoint", "pickup", "note", "door", "trapdoor", "locker", "enemy",
  "npc", "exit", "hint", "brazier", "fusebox", "source", "converter", "capacitor",
];
type Tab = "character" | "dialog" | "quest" | "gating";
const TABS: { id: Tab; label: string }[] = [
  { id: "character", label: "Character" },
  { id: "dialog", label: "Dialog" },
  { id: "quest", label: "Quest & Rewards" },
  { id: "gating", label: "Spawn Gating" },
];

export interface QuestBuilderOptions {
  entity: RoomEntity;
  content: Content;
  roomId: string;
  /** Snapshot for undo, before any mutation. */
  onBeforeChange: () => void;
  /** Mark the room dirty + repaint the canvas, after any mutation. */
  onChange: () => void;
  /** Modal closed (✕, Done, or backdrop click) — re-render the trigger row. */
  onClose: () => void;
}

/** First entity anywhere carrying this npcId, for its avatar/color — same
 *  "cast identity" lookup the macro tab uses, so gating chips show the real
 *  look instead of a bare id string. */
function npcLook(content: Content, npcId: string): { avatar: NpcAvatar; color: string } | null {
  for (const room of Object.values(content.rooms)) {
    for (const e of room.entities) {
      if (e.type === "npc" && e.npcId === npcId && e.avatar) {
        return { avatar: e.avatar, color: e.color ?? "#8f87ad" };
      }
    }
  }
  return null;
}

export function openQuestBuilder(opts: QuestBuilderOptions): void {
  const { entity: sel, content } = opts;
  // Back-fill fields authored before this panel existed (or by hand-editing
  // JSON), same convention as the inspector's own npcId/requiresHelped
  // back-fill — every field this panel edits needs to already be a key on
  // the object, not just present-when-truthy.
  const s = sel as unknown as Record<string, unknown>;
  if (!("npcId" in s)) s.npcId = "";
  if (!("requiresHelped" in s)) s.requiresHelped = [];
  if (!("hiddenIfHelped" in s)) s.hiddenIfHelped = [];
  if (!("dialogAsk" in s)) s.dialogAsk = "";
  if (!("dialogConfirm" in s)) s.dialogConfirm = "";
  if (!("dialogDone" in s)) s.dialogDone = "";
  if (!("dialogAfter" in s)) s.dialogAfter = "";

  let tab: Tab = "character";
  const overlay = el("div", { className: "pp-pixmodal" });
  const panel = el("div", { className: "pp-questpanel" });
  overlay.append(panel);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

  function close(): void {
    overlay.remove();
    opts.onClose();
  }

  /** Every field edit routes through here: undo snapshot before, dirty +
   *  repaint after, then a full modal re-render (mirrors the sidebar's own
   *  pushUndo/markDirty/renderInspector rhythm). */
  function mutate(fn: () => void): void {
    opts.onBeforeChange();
    fn();
    opts.onChange();
    render();
  }

  function render(): void {
    panel.replaceChildren(
      headerEl(),
      el("div", { className: "pp-questbody" }, navEl(), el("div", { className: "pp-questcontent" }, tabContentEl())),
      el("div", { className: "pp-btnrow" },
        el("span", { style: "flex:1" }),
        el("button", { className: "pp-btn pp-primary", onclick: () => close() }, "Done")
      )
    );
  }

  function headerEl(): HTMLElement {
    const avatarCv = el("canvas", { width: 32, height: 32 }) as HTMLCanvasElement;
    const ctx = avatarCv.getContext("2d");
    if (ctx && sel.avatar) {
      const s2 = 30 / 16;
      drawNpcAvatar(ctx, sel.avatar, (32 - 12 * s2) / 2, (32 - 16 * s2) / 2, 12 * s2, 16 * s2, sel.color ?? "#8f87ad", 1, { t: 0.4 });
    }
    return el("div", { className: "pp-questhead" },
      avatarCv,
      el("div", {},
        el("div", { style: "font-weight:700;color:#fff;font-size:14px" }, sel.name || "(unnamed NPC)"),
        el("div", { style: "color:#8f87ad;font-size:10px;font-family:monospace" },
          `npcId: ${sel.npcId || "(none)"} · ${opts.roomId}`)
      ),
      el("span", { style: "flex:1" }),
      el("span", { className: "pp-questclose", onclick: () => close() }, "✕")
    );
  }

  function navEl(): HTMLElement {
    return el("div", { className: "pp-questnav" },
      ...TABS.map((t) => el("div", {
        className: "pp-questnavitem" + (t.id === tab ? " pp-active" : ""),
        onclick: () => { tab = t.id; render(); },
      }, t.label)),
      el("div", { style: "flex:1" }),
      el("p", { className: "pp-hint", style: "padding:8px 10px;line-height:1.5" },
        "Changes save with the room, same as any other entity field.")
    );
  }

  function tabContentEl(): HTMLElement {
    if (tab === "character") return characterTabEl();
    if (tab === "dialog") return dialogTabEl();
    if (tab === "quest") return questTabEl();
    return gatingTabEl();
  }

  function fieldWrap(label: string, control: HTMLElement, hint?: string): HTMLElement {
    return el("div", { className: "pp-questfield" },
      el("div", { className: "pp-questfieldlabel" }, label),
      control,
      hint ? el("div", { className: "pp-questfieldhint" }, hint) : el("span", {})
    );
  }

  // ---------- Character ----------
  function characterTabEl(): HTMLElement {
    const npcIdListId = "pp-quest-npcids";
    const nameInput = el("input", {
      type: "text", value: sel.name ?? "",
      oninput: (e) => { sel.name = (e.target as HTMLInputElement).value; opts.onBeforeChange(); opts.onChange(); },
    });
    const npcIdInput = el("input", {
      type: "text", value: sel.npcId ?? "", list: npcIdListId,
      oninput: (e) => { sel.npcId = (e.target as HTMLInputElement).value; opts.onBeforeChange(); opts.onChange(); },
    });
    const otherIds = allNpcIds(content).filter((id) => id !== sel.npcId);
    const colorPicker = el("input", {
      type: "color", value: sel.color ?? "#8f87ad",
      oninput: (e) => {
        const v = (e.target as HTMLInputElement).value;
        mutate(() => { sel.color = v; });
      },
    });
    const avatarSwatches = el("div", { className: "pp-questavatars" },
      ...AVATARS.map((a) => {
        const cv = el("canvas", { width: 24, height: 24 }) as HTMLCanvasElement;
        const ctx = cv.getContext("2d");
        if (ctx) {
          const s2 = 22 / 16;
          drawNpcAvatar(ctx, a, (24 - 12 * s2) / 2, (24 - 16 * s2) / 2, 12 * s2, 16 * s2, sel.color ?? "#8f87ad", 1, { t: 0.4 });
        }
        return el("div", {
          className: "pp-questavatar" + (a === sel.avatar ? " pp-active" : ""),
          title: a,
          onclick: () => mutate(() => { sel.avatar = a; }),
        }, cv);
      })
    );
    return el("div", {},
      fieldWrap("Display name", nameInput),
      fieldWrap("npcId — cast identity", npcIdInput,
        "Ties every room's copy of this NPC together — quests, portraits, and \"requires helped\" gates " +
        `all key off this.${otherIds.length ? ` Existing: ${otherIds.join(", ")}.` : ""}`),
      el("datalist", { id: npcIdListId }, ...allNpcIds(content).map((id) => el("option", { value: id }))),
      fieldWrap("Avatar", avatarSwatches),
      fieldWrap("Color", el("div", { className: "pp-questcolorrow" }, colorPicker,
        el("span", { className: "pp-hint" }, sel.color ?? "#8f87ad")))
    );
  }

  // ---------- Dialog ----------
  const DIALOG_STAGES: { key: "dialogAsk" | "dialogConfirm" | "dialogDone" | "dialogAfter"; label: string; hint: string }[] = [
    { key: "dialogAsk", label: "1 · First meeting", hint: "Shown the first time the player talks to them." },
    { key: "dialogConfirm", label: "2 · Has the item", hint: "Give/Keep choice — shown once the player is holding what they want. Only used by item-trade quests." },
    { key: "dialogDone", label: "3 · Just completed", hint: "Shown right after the trade, this visit only." },
    { key: "dialogAfter", label: "4 · Quest done", hint: "Shown on every later visit once the quest is complete." },
  ];
  function dialogTabEl(): HTMLElement {
    const stagesRow = el("div", { className: "pp-queststages" },
      ...DIALOG_STAGES.flatMap((st, i) => {
        const parts = [el("span", {}, st.label.split(" · ")[1])];
        if (i < DIALOG_STAGES.length - 1) parts.push(el("span", { className: "pp-questarrow" }, "→"));
        return parts;
      })
    );
    const areas = DIALOG_STAGES.map((st) =>
      fieldWrap(st.label, el("textarea", {
        rows: 3, value: sel[st.key] ?? "",
        oninput: (e) => {
          (sel as unknown as Record<string, string>)[st.key] = (e.target as HTMLTextAreaElement).value;
          opts.onBeforeChange(); opts.onChange();
        },
      }), st.hint)
    );
    return el("div", {}, stagesRow, ...areas);
  }

  // ---------- Quest & Rewards ----------
  function questTabEl(): HTMLElement {
    const itemIds = content.items.map((i) => i.id);
    const recipeIds = content.recipes.map((r) => r.id);
    const roomIds = Object.keys(content.rooms);
    const opt = (value: string, label: string, selected: boolean) =>
      el("option", { value, ...(selected ? { selected: true } : {}) }, label);

    const mode = sel.roomQuest ? "roomProgress" : sel.wants ? "trade" : "none";
    const modeRow = el("div", { className: "pp-questsegmented" },
      ...(["none", "trade", "roomProgress"] as const).map((m) => el("span", {
        className: "pp-questseg" + (m === mode ? " pp-active" : ""),
        onclick: () => mutate(() => {
          delete sel.wants;
          delete sel.roomQuest;
          if (m === "trade") sel.wants = { item: itemIds[0] ?? "", count: 1 };
          if (m === "roomProgress") sel.roomQuest = { roomId: opts.roomId, tileId: content.tiles[0]?.id };
        }),
      }, m === "none" ? "None" : m === "trade" ? "Item Trade" : "Room Progress"))
    );

    const body: HTMLElement[] = [fieldWrap("Quest type", modeRow)];

    if (mode === "trade" && sel.wants) {
      const wants = sel.wants;
      body.push(fieldWrap("Wants", el("div", { className: "pp-questrow" },
        el("select", {
          onchange: (e) => mutate(() => { wants.item = (e.target as HTMLSelectElement).value; }),
        }, ...itemIds.map((id) => opt(id, id, id === wants.item))),
        el("span", {}, "×"),
        el("input", {
          type: "number", value: wants.count, min: "1", step: "1",
          oninput: (e) => {
            const n = parseInt((e.target as HTMLInputElement).value, 10);
            if (!Number.isNaN(n) && n > 0) { wants.count = n; opts.onBeforeChange(); opts.onChange(); }
          },
        })
      )));
    }

    if (mode === "roomProgress" && sel.roomQuest) {
      const rq = sel.roomQuest;
      const enemyIds = content.enemies.map((e) => e.id);
      const trackMode = rq.enemyId ? "enemy" : rq.entityType ? "entity" : "tile";
      body.push(
        fieldWrap("Room", el("select", {
          onchange: (e) => mutate(() => { rq.roomId = (e.target as HTMLSelectElement).value; }),
        }, ...roomIds.map((id) => opt(id, id, id === rq.roomId)))),
        fieldWrap("Tracking", el("select", {
          onchange: (e) => mutate(() => {
            const v = (e.target as HTMLSelectElement).value;
            delete rq.tileId; delete rq.entityType; delete rq.entityField; delete rq.enemyId;
            if (v === "tile") rq.tileId = content.tiles[0]?.id ?? "";
            else if (v === "entity") { rq.entityType = "brazier"; rq.entityField = "lit"; }
            else rq.enemyId = enemyIds[0] ?? "";
          }),
        },
          opt("tile", "Tile (popped / burned / melted...)", trackMode === "tile"),
          opt("entity", "Entity (open / lit)", trackMode === "entity"),
          opt("enemy", "Enemy (destroyed)", trackMode === "enemy"),
        ))
      );
      if (trackMode === "tile") {
        body.push(fieldWrap("Tile id", el("select", {
          onchange: (e) => mutate(() => { rq.tileId = (e.target as HTMLSelectElement).value; }),
        }, ...content.tiles.map((t) => opt(t.id, `${t.id} — ${t.name}`, t.id === rq.tileId)))));
      } else if (trackMode === "entity") {
        body.push(
          fieldWrap("Entity type", el("select", {
            onchange: (e) => mutate(() => { rq.entityType = (e.target as HTMLSelectElement).value; }),
          }, ...ENTITY_PROGRESS_TYPES.map((t) => opt(t, t, t === rq.entityType)))),
          fieldWrap("Field", el("select", {
            onchange: (e) => mutate(() => { rq.entityField = (e.target as HTMLSelectElement).value as "open" | "lit"; }),
          },
            opt("open", "open", rq.entityField === "open"),
            opt("lit", "lit", rq.entityField === "lit"),
          ))
        );
      } else {
        body.push(fieldWrap("Enemy", el("select", {
          onchange: (e) => mutate(() => { rq.enemyId = (e.target as HTMLSelectElement).value; }),
        }, ...enemyIds.map((id) => opt(id, id, id === rq.enemyId))),
          "Stuns wear off, so only destroyed enemies count — a killed enemy stays gone for the rest of the run."));
      }
      const targetRoom = content.rooms[rq.roomId];
      const progress = targetRoom
        ? (rq.tileId
            ? tileProgress(targetRoom, content, emptyRoomMutations(), rq.tileId)
            : rq.enemyId
              ? enemyProgress(targetRoom, emptyRoomMutations(), rq.enemyId)
              : entityProgress(targetRoom, emptyRoomMutations(), rq.entityType ?? "", rq.entityField ?? "open"))
        : { total: 0, done: 0 };
      body.push(el("p", { className: "pp-hint" },
        `${progress.done} / ${progress.total} in "${rq.roomId}" as authored (a fresh run, no progress applied)`));
    }

    const rewardItems = sel.rewardItems ?? (sel.rewardItems = []);
    const rewardRows = rewardItems.map((r, i) => el("div", { className: "pp-questrow" },
      el("select", {
        onchange: (e) => mutate(() => { r.item = (e.target as HTMLSelectElement).value; }),
      }, ...itemIds.map((id) => opt(id, id, id === r.item))),
      el("span", {}, "×"),
      el("input", {
        type: "number", value: r.count, min: "1", step: "1",
        oninput: (e) => {
          const n = parseInt((e.target as HTMLInputElement).value, 10);
          if (!Number.isNaN(n) && n > 0) { r.count = n; opts.onBeforeChange(); opts.onChange(); }
        },
      }),
      el("span", { className: "pp-questclose", onclick: () => mutate(() => { rewardItems.splice(i, 1); }) }, "✕"),
    ));
    const rewardRecipes = sel.rewardRecipes ?? (sel.rewardRecipes = []);
    const recipeRows = rewardRecipes.map((rid, i) => el("div", { className: "pp-questrow" },
      el("select", {
        onchange: (e) => mutate(() => { rewardRecipes[i] = (e.target as HTMLSelectElement).value; }),
      }, ...recipeIds.map((id) => opt(id, id, id === rid))),
      el("span", { className: "pp-questclose", onclick: () => mutate(() => { rewardRecipes.splice(i, 1); }) }, "✕"),
    ));
    body.push(fieldWrap("Rewards", el("div", {}, ...rewardRows, ...recipeRows,
      el("div", { className: "pp-btnrow" },
        el("button", { className: "pp-btn", onclick: () => mutate(() => { rewardItems.push({ item: itemIds[0] ?? "", count: 1 }); }) }, "+ reward item"),
        el("button", { className: "pp-btn", onclick: () => mutate(() => { rewardRecipes.push(recipeIds[0] ?? ""); }) }, "+ reward recipe"),
      ))));

    return el("div", {}, ...body);
  }

  // ---------- Spawn Gating ----------
  function gatingTabEl(): HTMLElement {
    const ids = allNpcIds(content).filter((id) => id !== sel.npcId);
    const requiresHelped = sel.requiresHelped ?? (sel.requiresHelped = []);
    const hiddenIfHelped = sel.hiddenIfHelped ?? (sel.hiddenIfHelped = []);
    const chipList = (arr: string[]) => el("div", { className: "pp-chiplist" },
      ...(ids.length === 0
        ? [el("span", { className: "pp-hint" }, "no other NPCs have an npcId set yet")]
        : ids.map((id) => {
            const look = npcLook(content, id);
            const cv = el("canvas", { width: 18, height: 18 }) as HTMLCanvasElement;
            if (look) {
              const ctx = cv.getContext("2d");
              if (ctx) {
                const s2 = 16 / 16;
                drawNpcAvatar(ctx, look.avatar, (18 - 12 * s2) / 2, (18 - 16 * s2) / 2, 12 * s2, 16 * s2, look.color, 1, { t: 0.4 });
              }
            }
            return el("label", { className: "pp-chip" },
              el("input", {
                type: "checkbox", ...(arr.includes(id) ? { checked: true } : {}),
                onchange: (e) => mutate(() => {
                  const checked = (e.target as HTMLInputElement).checked;
                  const i = arr.indexOf(id);
                  if (checked && i === -1) arr.push(id);
                  if (!checked && i !== -1) arr.splice(i, 1);
                }),
              }),
              cv, id,
            );
          })
      ),
    );
    return el("div", {},
      fieldWrap("Requires helped", chipList(requiresHelped),
        "Only spawns once every checked NPC has been helped this run."),
      fieldWrap("Hidden if helped", chipList(hiddenIfHelped),
        "Skipped if any checked NPC has already been helped — the solo-scene fallback."),
    );
  }

  render();
  document.body.append(overlay);
}
