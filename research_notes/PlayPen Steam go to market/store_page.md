# PlayPen Steam Store Page Blueprint (composition, copy, assets, tags)

Baseline: the local skill `C:\Users\SeanF\.claude\skills\steam-store-page\SKILL.md` (20 top-selling Sep 2025 to Sep 2026 indie pages, cited as [T], plus Zukowski/howtomarketagame, cited as [Z]). These notes verify and extend it against external sources and apply it to PlayPen. Skill-only claims I could not re-verify are marked "(skill, unverified here)". Research date: 2026-10-19.

Two 2025 platform changes matter and postdate much of the "classic" advice:
- Since Aug 2025, Steam accepts MP4/WebM clips in the description in place of GIFs (max 100MB, max 12 s each). Valve transcodes them for desktop, Deck and mobile, and converted about 292,000 existing GIFs. Clips autoplay and now have a play/pause button; pausing one pauses all. — [GamingOnLinux, Aug 2025](https://www.gamingonlinux.com/2025/08/steam-is-getting-wider-and-more-responsive-store-pages); [Insider Gaming](https://insider-gaming.com/valve-introducing-new-changes-to-steam-store-pages)
- Store pages widened from 940px to 1200px and became responsive. Most of the extra width goes to the media/description column (780px), so screenshots, video and description media show larger. This was in Beta first (Aug 2025). — [GamingOnLinux](https://www.gamingonlinux.com/2025/08/steam-is-getting-wider-and-more-responsive-store-pages)

---

## Capsule art (header, small, main, vertical, library hero/logo)

### Takeaway
Use the Aug 2024 2x sizes (header 920×430, small 462×174, main 1232×706, vertical 748×896). No text except the logo, and the logo must survive Steam's auto-generated 120×45 small capsule. For PlayPen, go character-forward: Subject #67 (the dashed, unfinished sketch) as the focal point, with the Warden looming as the "menace". That one image shows both the comedy and the genre.

### Cited Findings
- The header capsule (920×430, required) appears at the top of the store page, in "Recommended For You", in Big Picture and in Daily Deals. No text beyond the title is allowed, and the logo must be legible. Smaller versions are auto-generated. — [Steamworks: Standard Assets](https://partner.steamgames.com/doc/store/assets/standard)
- The small capsule (462×174) is used in search results, top sellers and new releases. The logo "should nearly fill the capsule". Steam auto-generates 120×45 and 184×69 versions, and the art does not have to match the other capsules. — [Steamworks: Standard Assets](https://partner.steamgames.com/doc/store/assets/standard)
- The main capsule (1232×706) appears in the front-page carousel. The vertical capsule (748×896) appears at the top of the front page during seasonal sales and on sale pages. Both allow no text beyond the title. — [Steamworks: Standard Assets](https://partner.steamgames.com/doc/store/assets/standard)
- Time-limited text ("OUT NOW", update and sale callouts) goes through Artwork Overrides, which expire automatically. The base capsule should stay constant. — [Steamworks: Standard Assets](https://partner.steamgames.com/doc/store/assets/standard)
- Steam began accepting the larger capsule sizes in Aug 2024 and no longer accepts the old ones (the header was 460×215). — [Steamworks assets overview, via search summary](https://partner.steamgames.com/doc/store/assets); [Steam Page Analyzer: capsule sizes](https://www.steampageanalyzer.com/blog/steam-capsule-sizes)
- The page background (1438×810) is optional and should be "ambient". If it is missing, Steam builds one from the last screenshot. — [Steamworks: Standard Assets](https://partner.steamgames.com/doc/store/assets/standard)
- Library sizes: library capsule 600×900, hero 3840×1240 with no text, logo 1280×720 transparent (skill, unverified here; the library header at 920×430 is corroborated by [Steam Page Analyzer](https://www.steampageanalyzer.com/blog/steam-capsule-sizes)).
- In the skill's sample, 12/12 top capsules carry a big logo and 9/12 show characters or the hero vehicle. Zukowski's rules: professional illustration, never a screenshot; genre conventions plus a character, with everything pointing at the character; no split focus. — skill [T]/[Z] (SKILL.md)
- Zukowski lists "a professionally made capsule" as one of five prerequisites for posting a Coming Soon page. He says illustrated capsules are acceptable even for pixel-art games. — [howtomarketagame, Mar 2025](https://howtomarketagame.com/2025/03/10/when-should-i-post-my-steam-coming-soon-page/)

### Inferences
- **Character-forward beats scene-forward for PlayPen.** The selling points are a personality (the Warden) and a strange protagonist (an unfinished sketch). A scene of a room full of systems will not read at 231×87. Recommended composition: Subject #67 mid-action and small but central (for example dodging a lava drip or holding a lit torch), with the Warden's face or eye filling the background or top as an oversized overseer. The Portal / GLaDOS "you're being watched" read is a known genre convention for comedic menace. The logo goes on the opposite side.
- **The sketch-look risk.** A dashed outline with a missing chunk is the character's identity, but at 120×45 a dashed line disappears. The capsule needs a bolder, simplified version of the sketch silhouette, such as a thick outline with one obvious notch. Test it at the 120×45 and 184×69 auto-generated sizes.
- The logo "PlayPen" is short. That suits the small capsule's "nearly fill" rule well, so make the small capsule almost all logo plus Subject #67's head.
- Do the capsule only after the reskin locks (Zukowski's "art style settled" prerequisite). A placeholder-art capsule will need a full redo.
- Hold back the Warden's best line for the trailer, not the capsule. Capsules can't carry text beyond the title.

### Gaps
- I found no public A/B data comparing character-forward and scene-forward capsules specifically for comedy games. The recommendation is inference from Zukowski's general rules plus the [T] counts.
- I didn't re-fetch the library asset spec page to confirm the hero and logo dimensions.

---

## Short description

### Takeaway
Up to 300 characters, in the order genre, then hook, then verbs. The hook should be the Warden and its premise (escape a facility whose overseer mocks you), and the verbs should be the systemic interactions. Don't use "hilarious" or "funny". Let a concrete absurd premise carry the comedy, the way TGYH's "absurd comedy slapformer" and Stanley Parable's paradox lines do.

### Cited Findings
- Pizza Tower: "Pizza Tower is a fast paced 2D platformer, with an emphasis on movement, exploration and score attack" (the name-is-genre formula, followed by verbs). — [Steam: Pizza Tower](https://store.steampowered.com/app/2231450/Pizza_Tower/)
- Baba Is You: "Baba Is You is a puzzle game where the rules you have to follow are present as blocks…", followed by a mechanic and its consequence ("cause surprising interactions!"). This is a systemic-puzzle precedent close to PlayPen's element kernel. — [Steam: Baba Is You](https://store.steampowered.com/app/736260/Baba_Is_You/)
- Thank Goodness You're Here!: "absurd comedy slapformer set in the bizarre Northern English town of Barnsworth". It then gives a concrete premise (a traveling salesman doing increasingly strange jobs for locals). — [Steam: TGYH](https://store.steampowered.com/app/2366980/)
- Stanley Parable: Ultra Deluxe uses paradox lines in the narrator's voice ("You are not here to win…"). This is the voice-first approach, but it leans on an existing IP. — [Steam: Stanley Parable UD](https://store.steampowered.com/app/1703340/The_Stanley_Parable_Ultra_Deluxe/)
- Viewfinder opens with an imperative-verb triad ("Challenge perception, redefine reality, and reshape the world…"). — [Steam: Viewfinder](https://store.steampowered.com/app/1382070/Viewfinder/)
- Formula counts in the skill's sample: imperative verb 8/20, "[Name] is a [genre]" 6/20, target length 200–290 characters 13/20. Zukowski's banned words include unique, fun, creative, colorful, original, interesting and hilarious. — skill [T]/[Z]

### Inferences
- Three drafts to test with puzzle-platformer fans, following the skill's "write 3, test" rule:
  1. *Name/genre formula:* "PlayPen is a comedic puzzle-platformer about escaping a playroom run by The Warden, who has opinions about you. Melt ice with lava, flood rooms, electrify water and craft anything from anything, while he narrates every failure." (about 230 characters)
  2. *Imperative:* "Escape The Warden's playroom, one puzzle room at a time. Burn, flood, freeze and electrify your way past his traps, craft tools from whatever you find, and help the residents he forgot about. He'll be commenting the whole time."
  3. *A [genre] where…:* "A 2D puzzle-platformer where fire, water, lava, ice and electricity all react, and your jailer won't stop talking. Combine anything, solve each room more than one way, and get out of the PlayPen before The Warden finishes your file."
- Draft 3 surfaces the systemic "≥2 solutions" pillar from CLAUDE.md, which is a real differentiator against linear puzzle platformers. Every claim must be true in the build at listing time (multiple solutions, residents, crafting).
- Avoid "comedy-horror" in the short description unless the reskin actually reads as horror. It invites the Psychological Horror audience (see Tags).

### Gaps
- I found no conversion data that compares short-description formulas. The evidence is pattern-matching from successful pages only.

---

## Trailer

### Takeaway
One 60–90 s gameplay trailer with gameplay in the first 2–5 seconds and no studio logo up front. The Warden's lines appear on screen as in-game text banners from the first shot, so the comedy and the gameplay arrive together. Optionally add a second, deeper "systems" trailer. More than two pushes screenshots out of view.

### Cited Findings
- Gameplay that appears 15–30 s into a Steam trailer is too late. Viewers scrub the progress bar looking for raw gameplay (Zukowski's research). Derek Lieu front-loads a few seconds of gameplay "before viewers reach for the progress bar" (his Noita and Tactical Breach Wizards trailers). Story and cinematics are "nice to have" layers supporting the core loop. — [GameDiscoverCo, Sep 2022](https://newsletter.gamediscover.co/p/game-trailers-breaking-down-a-key) (2022, older but still the consensus)
- Lieu's structure is genre, then hook, then content. The hook goes in the first 10–15 s and no later than the first half. — [WN Hub summary of Lieu](https://wnhub.io/news/analytics/item-237)
- A 60–90 s gameplay trailer and a 30–45 s teaser is the commonly cited length guidance (secondary, not a direct Lieu quote). Lieu's own trailers often run about 2 minutes. — [presskit.gg trailer guide](https://presskit.gg/field-guides/game-trailers-screenshots-guide); [WN Hub](https://wnhub.io/news/analytics/item-237)
- For a Coming Soon page, a roughly 30 s gameplay trailer is enough. Show gameplay in the first 5 seconds and don't open with studio or engine logos. — [howtomarketagame, Mar 2025](https://howtomarketagame.com/2025/03/10/when-should-i-post-my-steam-coming-soon-page/)
- A muted developer-commentary trailer can read as raw gameplay (Spelunky 2 put one first). Stacking many trailers and never pruning them is a mistake (Resident Evil Village). — [GameDiscoverCo](https://newsletter.gamediscover.co/p/game-trailers-breaking-down-a-key)
- Store videos autoplay muted. Assume no audio on the first view (skill [Z] guidance; I did not re-verify Steam's current mute default).

### Inferences
- **PlayPen trailer beat sheet (about 75 s).**
  - 0–3 s: Subject #67 touches a torch to an oil/flammable block, and the room ignites. A Warden banner types in: "Ah. Subject 67 has discovered fire. Again."
  - 3–15 s: a rapid element chain (fire melts ice → water floods → electrified pool fries a creature). This is the genre-plus-hook in one shot.
  - 15–40 s: three puzzle rooms solved two different ways (split screen or back-to-back). This proves the systemic claim.
  - 40–55 s: a crafting combine plus an NPC resident quest.
  - 55–70 s: a montage of escalating Warden banners over failures and deaths. Comedy lands best on the player's failure.
  - 70–75 s: logo, "Wishlist now", and a "Play the demo" card if a demo exists.
- Because the Warden is text-only, the banners ARE the voice. Render them at a size readable in the store's inline player. The page is wider since 2025, but test at about 600px video width.
- **Comparables to study** (not fetched; trailers weren't viewable via fetch): Portal 2 and Stanley Parable, where the narrator voice carries the trailer. Their lesson is that the antagonist speaks over gameplay, not over cinematics. Baba Is You, Viewfinder, Superliminal and Animal Well: mechanic-first, little text. Getting Over It: the narrator over raw failure.

### Gaps
- I could not retrieve the actual trailers or their timings for Portal 2, Stanley Parable, TGYH, Pizza Tower, Baba Is You, Viewfinder, Superliminal, Animal Well, Chants of Sennaar or Getting Over It. WebFetch of store pages returned no video data. The beat-by-beat comparison of how comedy and narrator games trail is therefore unverified.
- I found no 2024–2026 data on trailer length versus wishlist conversion.

---

## Screenshots

### Takeaway
8–12 screenshots at 1920×1080 or larger. Screenshot #1 must be real gameplay with the Warden banner visible on screen. #1–#4 should be the four beats of the core loop (element reaction, puzzle room, crafting, Warden or NPC moment), because those four appear in the hover tooltip.

### Cited Findings
- At least 5 screenshots are required, at 1920×1080 minimum, 16:9. They must show gameplay only: no concept art, pre-rendered cinematics, awards or marketing copy. Mark at least 4 "suitable for all ages", or they may not appear in some Steam areas. — [Steamworks: Standard Assets](https://partner.steamgames.com/doc/store/assets/standard)
- The skill's sample has a median of 10 screenshots, and #1 is in-game from the real camera in 12/12. The first 4 appear in the hover tooltip. Show the in-game UI, and make every shot visibly different (at least 3 environments). — skill [T]/[Z]
- Zukowski: show enough art for 3 unique environments, so the game doesn't read as a one-asset-pack flip. — [howtomarketagame, Mar 2025](https://howtomarketagame.com/2025/03/10/when-should-i-post-my-steam-coming-soon-page/)
- Since Aug 2025 the media column is 780px wide on the 1200px page, so screenshots display larger. — [GamingOnLinux](https://www.gamingonlinux.com/2025/08/steam-is-getting-wider-and-more-responsive-store-pages)

### Inferences
- Proposed order:
  1. A mid-chain element reaction (lava meeting water, with cracked stone forming) plus a Warden taunt banner on screen.
  2. A flooded room with a drain, and the player swimming.
  3. The crafting workbench mid-combine.
  4. An NPC resident dialog with a quest marker.
  5. An electrified puzzle.
  6. A spotter enemy and sight cone being snuck past.
  7. Burning toyblocks.
  8. A brazier puzzle.
  9. A big multi-level room.
  10. The Warden at his most menacing (still gameplay, for example a confiscation moment).
- Each shot should come from a different room or biome once the reskin delivers distinct environments.
- PlayPen renders at 640×360 logical. Export screenshots by integer upscale (3×, to 1920×1080) so pixels stay crisp. The engine already has `canvas.toDataURL` and the dev-receiver pipeline.
- Make sure the taunt banners in screenshots aren't covered by mobile touch UI. Capture in desktop mode.

### Gaps
- I found no external data on how much shots #5 and later contribute to conversion compared with the first 4.

---

## "About This Game" section

### Takeaway
Use the 2025 MP4/WebM clip support. Repeat a block of ALL-CAPS header, then 1–3 sentences in the Warden's or a dry voice, then an autoplay clip of 12 s or less, 4–6 times. Put one key-features bullet list at the bottom. Keep it to about 200–350 words. Open with a clip, not text.

### Cited Findings
- Description clips: MP4/WebM, 12 s max, 100MB max, autoplay with a pause button, transcoded by Valve. — [GamingOnLinux, Aug 2025](https://www.gamingonlinux.com/2025/08/steam-is-getting-wider-and-more-responsive-store-pages); [Insider Gaming](https://insider-gaming.com/valve-introducing-new-changes-to-steam-store-pages)
- Pizza Tower's About is about 150 words: an opening paragraph, then five ALL-CAPS verb headers (PLAY, EXPLORE, FIGHT, DESTROY, BECOME), each with a short line and an image. A 4-item bullet list follows, then a closing image. The tone is energetic and jokey. — [Steam: Pizza Tower](https://store.steampowered.com/app/2231450/Pizza_Tower/)
- Baba Is You's About is about 150 words of prose with 3–4 image banners between paragraphs and no bullets. — [Steam: Baba Is You](https://store.steampowered.com/app/736260/Baba_Is_You/)
- Viewfinder's About is about 150 words with four bullets (bold lead-ins) and no inline media. — [Steam: Viewfinder](https://store.steampowered.com/app/1382070/Viewfinder/)
- Stanley Parable UD's About is about 250 words of plain-text prose in the narrator's wry voice, with no media. It ends on a question. This works because of IP recognition, not as a template for a new title. — [Steam: Stanley Parable UD](https://store.steampowered.com/app/1703340/The_Stanley_Parable_Ultra_Deluxe/)
- In the skill's sample, 18/20 use autoplay loops (median 4), 17/20 put a visual within the first 50 words, and 14/20 place one feature list at the bottom. The median length is 343 words. Jokey copy that matches the game works (How to Fish, RV There Yet?). — skill [T]

### Inferences
- **PlayPen About blueprint (about 300 words):**
  0. A 12 s clip with no text above it: the Warden banner greets a fresh Subject #67, who immediately sets something on fire.
  1. **EVERYTHING REACTS**: fire, water, lava, ice and electricity follow rules, not scripts. Clip: an element chain reaction.
  2. **EVERY ROOM IS A PUZZLE BOX (WITH MORE THAN ONE WAY OUT)**: clip of the same room solved two ways.
  3. **COMBINE ANYTHING**: clip of the crafting workbench to a new tool to use in the world.
  4. **THE RESIDENTS NEED A FAVOR**: clip of an NPC quest hand-off.
  5. **THE WARDEN IS WATCHING**: a short block written as a Warden "intake memo" (in-voice copy), with a clip of a death followed by a taunt.
  6. KEY FEATURES bullets: number of rooms, number of elements, crafting recipe count, NPCs, browser-demo availability, controller/Deck support (only if true).
- Writing the section headers or one block in the Warden's voice applies the "voice is part of the brand" finding and is the best text-only showcase of the antagonist. Keep the rest plain and descriptive so the genre stays legible.
- Use thin image-banner headers matching the reskin's branding if the artists have time. Otherwise use text h2 headers. Zukowski warns a bare page "looks like you don't care" (skill).

### Gaps
- I couldn't retrieve TGYH's About body (the fetch truncated it), and I didn't check whether the comparables currently use clips or static images (Pizza Tower's AVIFs couldn't be confirmed as animated).

---

## Tags

### Takeaway
Up to 20 tags. The top 5 carry the most weight and appear in the tooltip. Less-common tags count for more in recommendations. Lead with Puzzle Platformer / 2D Platformer / Comedy / Physics / Dark Humor. Keep Indie, Casual, Adventure and Action out of the top 5. Avoid Horror and Psychological Horror unless the reskin delivers real horror, because they pull in an audience the game won't satisfy.

### Cited Findings
- At least 5 tags are required before launch, and 20 are recommended. Only the top 20 are visible and used for visibility. The top 5 "should clearly describe the game". Some filters use only the first 15. Players' tags mix in and can shift weight over time. Recommendations weight overlap across the top 20 more than order, and less-common tags count more than common ones like "Action". More Like This is driven by the top 20. Demos inherit the base game's tags. — [Steamworks: Tags](https://partner.steamgames.com/doc/store/tags)
- Suggest Prioritization moves sub-genres up and generic tags (indie, singleplayer) down, but it doesn't know your game. — [Steamworks: Tags](https://partner.steamgames.com/doc/store/tags)
- Zukowski: developer-chosen tags weigh more than shopper tags. Community-added tags like "indie" can creep into the top 5. Diagnostic: if More Like This shows random genres, Steam doesn't know what your game is. — [howtomarketagame: Steam 101 tags (2020)](https://howtomarketagame.com/2020/11/12/steam-101-how-to-tag-your-game/) (older, still consistent with Valve's doc)
- More Like This tends to recommend bigger, better-reviewed games in the broad genre rather than very specific matches (secondhand observation). — [GameDiscoverCo: prioritizing tags](https://newsletter.gamediscover.co/p/are-you-prioritizing-your-steam-tags)
- Comparable tag stacks, in order:
  - Viewfinder: Puzzle Platformer, Puzzle, First-Person, Singleplayer, Abstract, Surreal, Psychological, Adventure, Physics, Atmospheric, Dark Humor… — [Steam](https://store.steampowered.com/app/1382070/Viewfinder/)
  - TGYH: Adventure, Comedy, Funny, Hand-drawn, Exploration, Casual, 2D Platformer, Indie, 2D, Platformer, Short, Side Scroller, Cartoon… Puzzle, Open World, Cinematic, Puzzle Platformer. — [Steam](https://store.steampowered.com/app/2366980/)
  - Pizza Tower: Great Soundtrack, 2D Platformer, Fast-Paced, Indie, Cartoony, Funny, Platformer, Pixel Graphics, Singleplayer, Comedy… — [Steam](https://store.steampowered.com/app/2231450/Pizza_Tower/)
  - Baba Is You: Puzzle, Indie, Difficult, Singleplayer, Logic, Pixel Graphics, Cute, Sokoban, 2D, Programming… Funny. — [Steam](https://store.steampowered.com/app/736260/Baba_Is_You/)
  - Stanley Parable UD: Multiple Endings, Choices Matter, Comedy, Walking Simulator, First-Person, Singleplayer, Funny, Psychological Horror… Dark Humor. — [Steam](https://store.steampowered.com/app/1703340/The_Stanley_Parable_Ultra_Deluxe/)
  - Note: these are the current player-weighted orders on released games, not the developers' launch picks.
- The Crafting tag had about 686 entries in an undated Game Developer snapshot. — [Game Developer: analyzing top Steam tags](https://gamedeveloper.com/business/analyzing-the-top-steam-tags-2)

### Inferences
- **Proposed top-20 for PlayPen, in order:**
  1. **Puzzle Platformer**: the most precise genre anchor. Viewfinder's #1. TGYH also carries it.
  2. **2D Platformer**: the camera and genre convention, shared with TGYH and Pizza Tower.
  3. **Comedy**: the hook. Stanley Parable has it at #3 and TGYH at #2.
  4. **Physics**: honest for fluid flow and the element sim, and a high-information tag (Viewfinder's #9).
  5. **Dark Humor**: captures the Portal/Warden menace-comedy register without promising horror. Viewfinder and Stanley Parable both carry it.
  6. Puzzle
  7. Crafting: a real feature, but the tag skews toward survival-crafting audiences, so keep it out of the top 5.
  8. Funny
  9. Logic
  10. Sandbox (the systemic kernel; verify the tag exists and fits in the Tag Wizard)
  11. Exploration
  12. Story Rich (only if the NPC arc lands at launch)
  13. Side Scroller
  14. Platformer
  15. 2D
  16. Cartoony, or Hand-drawn / Pixel Graphics depending on the reskin. Choose after the art locks.
  17. Surreal
  18. Singleplayer
  19. Cute (if the reskin reads cute-menacing)
  20. Indie
- **Avoid in the top 15:** Horror and Psychological Horror (horror players will feel baited), Casual (a difficulty mismatch for puzzle fans), Roguelike/Roguelite (the run state might suggest it, but the room puzzles are authored, not procedural), and Survival (Crafting already risks this association).
- After the page goes live, check that More Like This shows Viewfinder, Baba Is You, TGYH, Portal or Superliminal-type games. If it shows survival-crafting games, demote Crafting.

### Gaps
- I couldn't get current (2025–26) game counts per tag (Puzzle Platformer, Comedy, Dark Humor, Physics, Crafting), so I couldn't apply the skill's "niche tag (250–1,200 games) in the top 5" rule quantitatively. Get the counts from SteamDB's tag pages or the Tag Wizard.
- I didn't fetch the Portal 2, Superliminal, Animal Well, Chants of Sennaar or Getting Over It tag lists.

---

## Coming Soon page, demo, events cadence, follow

### Takeaway
Put the Coming Soon page up as soon as the reskin delivers a professional capsule, 3 distinct environments and a 30 s gameplay trailer. Don't wait for launch polish. Valve's hard floor is 2 weeks before release; the practical target is 6+ months. A demo (the browser build proves the game is playable) is the Next Fest vehicle. Post updates or events regularly, and use event "reminder" buttons for beta and demo dates.

### Cited Findings
- Zukowski's five prerequisites: genre locked; art style settled (not necessarily final); art for 3 unique environments; a professional capsule; a gameplay trailer (about 30 s is OK, with gameplay in the first 5 s and no logos first). Don't delay months for polish, but don't launch with gray boxes or default assets. — [howtomarketagame, Mar 2025](https://howtomarketagame.com/2025/03/10/when-should-i-post-my-steam-coming-soon-page/)
- Get the assets ready, pitch festivals, influencers and outlets for "a couple months", and launch the page yourself if nothing bites in about 3 months. First-time developers can test the waters for about 1 month. Wishlists don't meaningfully decay (Cosmoteer cohort data). Steam does not promote new pages; early traffic is "natural". — [howtomarketagame, Mar 2025](https://howtomarketagame.com/2025/03/10/when-should-i-post-my-steam-coming-soon-page/)
- Before the page, set up a newsletter with a clear CTA, then switch the CTA to "Wishlist on Steam" once the page is live. — [howtomarketagame, Mar 2025](https://howtomarketagame.com/2025/03/10/when-should-i-post-my-steam-coming-soon-page/)
- Valve recommends publishing Coming Soon as soon as you're ready to talk publicly. It must be up for at least 2 weeks before release. Some events (such as Next Fest) are open only to unreleased games. — [Steamworks: Coming Soon / release dates (via search summary)](https://partner.steamgames.com/doc/store/coming_soon)
- Steam Events can carry a reminder button so players get notified when an event starts (for example a beta). The Community Hub opens when the page goes visible. — [howtomarketagame: Steam events (2021)](https://howtomarketagame.com/2021/04/28/how-to-market-your-game-using-steams-events-system/) (older)
- The skill's (unverified here) numbers: Coming Soon at least 6 months out ("Valve: 300% more sales vs 30 days"), an update every 3 weeks or less, and the last Next Fest before launch with 2k+ wishlists. Next Fest median gains: 322 (under 1k wishlists), 1,006 (1k–10k), 5,215 (10k–100k). — skill [Z]
- Wishlisters get an email on release. Launch-week sales are commonly estimated at about 20% of wishlists (from a 2020 talk). — [howtomarketagame 10-step plan (2021)](https://howtomarketagame.com/2021/07/12/how-to-market-your-indie-game-a-10-step-plan/)

### Inferences
- PlayPen already runs in the browser. That gives a frictionless demo-before-Steam funnel (a playable link with a "Wishlist on Steam" CTA in the pause menu or end screen), and a Steam demo build later for Next Fest.
- Event cadence: use each content milestone that's already in the build log (new room, new NPC, reskin reveal per artist) as a Steam event every 2–3 weeks. Writers Studio output (new Warden lines) makes cheap, on-brand announcement content.
- **Notify me vs wishlist:** the main CTA on an unreleased page is Wishlist. Use "Follow" (developer/publisher homepage, for Corrupted Media Productions) as a secondary channel, because followers of a creator homepage get notified of that creator's future releases.

### Gaps
- I could not verify the "6 months / 300%" Valve stat, a current recommended event cadence, or how Follow and Curator/Creator homepage notifications currently behave (2025–26). No primary source was found in this pass.
- The 2024–2026 Next Fest wishlist medians weren't re-verified (they come from the skill).

---

## A/B iteration and funnel diagnosis (impressions → visits → wishlists)

### Takeaway
Steamworks reports impressions, CTR (page views divided by capsule impressions) and visits. The wishlist rate (wishlists divided by visits) you compute yourself. Rough bands: CTR of 2–4% is average and over 7% is top-tier. Visit-to-wishlist of about 8–12% is median for Coming Soon pages and 12–18% is good. Both bands come from a commercial blog and are directional only. Zukowski warns that CTR alone is a weak signal; track resting weekly wishlists instead.

### Cited Findings
- CTR as Valve calculates it is page views divided by capsule impressions. The wishlist-to-visit ratio isn't reported and must be computed. A high CTR often means Steam isn't showing you much, because low-traffic games show higher CTR. Prioritize impressions, page views and resting weekly wishlists. — [howtomarketagame, Sep 2022](https://howtomarketagame.com/2022/09/14/what-is-a-normal-click-through-rate-or-wishlist-rate-on-steam/)
- Resting weekly wishlist buckets by eventual gross revenue (survey of 100+ games): <$10k → 0–40/week; $10k–249k → 15–120; $250k–999k → 100–700; $1M+ → 300–3,000. The median was 23/week. Peglin sat in the low buckets for 6 months before a demo and streamers lifted it. — [howtomarketagame, Sep 2022](https://howtomarketagame.com/2022/09/14/what-is-a-normal-click-through-rate-or-wishlist-rate-on-steam/)
- CTR: 2–4% average, 4–7% good, over 7% top tier. Visit-to-wishlist: 8–12% median, 12–18% good, over 25% exceptional. No public dataset backs visit-to-wishlist rates by genre. — [Steam Page Analyzer](https://www.steampageanalyzer.com/blog/steam-store-page-conversion-benchmarks) (commercial blog; directional)
- Wishlist-to-sales: the median first-month conversion is 27% (sample of 700 games; 10th to 90th percentile 0.06–1.34). The launch-week median is about 0.15× for games with 25k+ wishlists, and about 0.10× when priced over $10. — [GameDiscoverCo via GameDevReports](https://gamedevreports.substack.com/p/gamediscoverco-conversion-benchmarks); [GameDiscoverCo 2024–25](https://gamedevreports.substack.com/p/gamediscoverco-the-state-of-steam)
- Steam has no native A/B testing for capsules. Artwork Overrides allow time-boxed swaps, which you can compare week over week. — [Steamworks: Standard Assets](https://partner.steamgames.com/doc/store/assets/standard) (the override mechanism; the "no native A/B" claim is my inference)

### Inferences
- **Diagnosis tree:**
  - Low impressions: tags or visibility, or not enough external traffic. Fix tags, run events, get into festivals.
  - Healthy impressions but CTR under about 2%: a capsule, name or top-5-tag problem.
  - Healthy visits but wishlist rate under about 8%: screenshots #1–4, the trailer's first 5 s, or the short description.
- Run sequential capsule tests of about 2 weeks each with no other promotion in the window, and compare CTR at similar impression volume. Don't swap capsules during a festival.
- Use the browser build's existing telemetry (`/api/telemetry`) to track the playtest-to-wishlist CTA click, so you have a funnel signal Steam doesn't give you.

### Gaps
- I found no official Valve-published CTR or conversion benchmarks, and no genre-specific (puzzle or comedy) conversion data.

---

## Presenting a voice-driven antagonist without voice acting (text banners)

### Takeaway
Treat the Warden's banners as the page's signature visual. Put them on screenshot #1, in the first 3 s of the trailer, and in the About clips, and write one About block in his voice. Comparable precedents carry the voice through copy (Stanley Parable's About and short description are written in the narrator's register). Pizza Tower and TGYH carry comedy through tone and premise rather than spoken lines.

### Cited Findings
- Stanley Parable UD's short description and About are written in the narrator's paradoxical voice ("You are not here to win…"). The voice IS the copy. — [Steam: Stanley Parable UD](https://store.steampowered.com/app/1703340/The_Stanley_Parable_Ultra_Deluxe/)
- Pizza Tower's About carries jokey, informal copy under action-verb headers. — [Steam: Pizza Tower](https://store.steampowered.com/app/2231450/Pizza_Tower/)
- TGYH puts its comedy in the premise ("absurd comedy slapformer…bizarre Northern English town"). — [Steam: TGYH](https://store.steampowered.com/app/2366980/)
- Screenshots can't contain marketing copy, but in-game UI text is gameplay. — [Steamworks: Standard Assets](https://partner.steamgames.com/doc/store/assets/standard)

### Inferences
- Because Warden banners are in-game UI, they're allowed in screenshots, while overlaid marketing text isn't. That is a structural advantage: every screenshot can carry a joke legally. Pick taunts that are funny without context and short (the banner already fits about 2 lines at about 6px/glyph per the voice lint). Make sure they're legible at the tooltip's thumbnail size, which may need a larger banner-scale capture mode.
- Have the writers produce 10–15 "store-grade" taunts that work cold, using the Writers Studio voice lint. Use them across screenshots, clips and trailer so no line repeats.
- Optional About device: a "SUBJECT INTAKE FORM" or "WARDEN'S NOTES" block (redacted-document styling). This is the GLaDOS-style "facility document" convention and shows personality without audio.
- Consider a typewriter sound or the synth "voice blips" in the trailer's audio track, since the banner typewriter already exists. Muted autoplay viewers still get the text.

### Gaps
- I couldn't retrieve trailer or page examples of games whose antagonist is text-only (no VO). Examples that might fit (Undertale-style text bark personalities, Inscryption's Leshy) weren't verified this pass. Portal 2's page wasn't fetched.
