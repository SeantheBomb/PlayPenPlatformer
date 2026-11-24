# Grenade Junky (Steam PC VR) as a Learning Run and Audience-Builder for PlayPen

Researched 2026-10-19. Source quality note: Valve Steamworks docs are primary. howtomarketagame (Zukowski) and GameDiscoverCo are expert secondary sources. Steam Page Analyzer, presskit.gg, FirstLook and similar sites are commercial tool vendors, so treat their figures as directional only. Older data is flagged inline.

## 1. Which learnings transfer across very different genres (VR shooter to 2D comedic puzzle-platformer), and which don't

### Takeaway
Process and studio infrastructure transfer: the Steamworks workflow, review/discount/sale mechanics, UTM discipline, press and creator pipelines, and the studio-level channels (Creator Homepage, mailing list, Discord). Market-signal learnings mostly do not. GJ's CTR, conversion, wishlist and sales numbers describe a tiny, shrinking PC VR shooter niche, not 2D puzzle-platformer demand. I found no rigorous study of cross-genre audience carryover. The evidence I did find (mostly mobile and creator data) says players and audiences don't follow a studio across genres automatically, and that studio or community identity carries over better than genre.

### Cited Findings
- Only 24% of US mobile players say their next game will definitely be the same genre (10% in Japan and South Korea). Genre is the top selection factor for 49% of players. Mobile data, so the analogy is indirect. — [The Drum, "The Power of Play"](https://www.thedrum.com/industry-insight/the-power-of-play)
- Gamesight's creator-audience analysis: teams "run into trouble when they assume that a creator's audience will automatically transition to a new game simply because it's similar." Even similar games don't transfer audiences automatically. — [Gamesight blog, Main Game Deviation](https://blog.gamesight.io/main-game-deviation-and-why-it-matters-for-your-influencer-selection/)
- Interest in community engagement crosses genres, so community built around a studio or brand may transfer better than community built around a game type (mobile/gacha context). — [Stream Hatchet, shared gacha audiences](https://streamhatchet.com/blog/the-shared-gacha-game-audiences-of-wuthering-waves-and-genshin-impact/)
- Zukowski says wishlists "really don't age." The exception is a big change in genre or tone, which can hurt conversion. That suggests an audience gathered for one genre converts poorly to another. — [Game World Observer summary of Zukowski, 11 Mar 2025](https://gameworldobserver.com/2025/03/11/steam-page-launch-guide-wishlists-zukowski)
- Postmortem roundups show developers changing genre between games is common, but none of them quantifies follower carryover. — [howtomarketagame, What worked in 2021 (older)](https://howtomarketagame.com/2021/12/27/what-worked-in-2021/); [itch.io postmortems](https://itch.io/devlogs/books/postmortems)
- Zukowski's five pre-launch rules (commit to one genre, settle art style before launch, show 3+ environments, professional capsule art, trailer opens on gameplay) don't depend on genre. They are process learnings that transfer. — [Game World Observer, Mar 2025](https://gameworldobserver.com/2025/03/11/steam-page-launch-guide-wishlists-zukowski)

### Inferences
- **What transfers from GJ to PlayPen:**
  - Steamworks partner workflow and store-page/build review turnaround
  - Depot/branch/build pipeline
  - Launch-day operations
  - Discount and sale-invitation calendar mechanics
  - Event/announcement cadence and its effect on follower visits
  - UTM tagging habits, plus which external channels CMP can actually move (Discord, Reddit, newsletter, press)
  - Key-distribution operations and response rates from curators/streamers (as a process measure)
  - Refund-reason categories (partly)
  - The size and responsiveness of CMP's own owned channels
- **What does NOT transfer:**
  - Absolute impressions, CTR and wishlist rates (genre- and VR-filter-dependent)
  - Sales per wishlist
  - Price elasticity (VR $10 vs. a 2D indie)
  - Regional split (the VR hardware distribution skews it)
  - Review velocity, since PC VR has a small buyer pool
  - Whether "PvP vs. campaign" messaging wins (a GJ-specific positioning question)
- GJ's Meta history already hints at a transferable creative lesson: lead with what reviewers praise (campaign, humor, movement) rather than what the team assumes is the hook (PvP). PlayPen's hook (taunting antagonist plus comedic tone) is also humor-led, so A/B evidence from GJ's capsules and short description on whether humor-forward messaging lifts CTR is a weak but real signal for PlayPen.
- A poor GJ Steam result should be read as "PC VR niche plus a 3-year-old Quest game," not as a verdict on CMP's marketing ability or on PlayPen.

### Gaps
- I found no dataset or named case study measuring how many of a studio's Steam followers or buyers of game A bought a different-genre game B. Searches of howtomarketagame, Game Developer and itch postmortems turned up nothing quantitative.

## 2. Which Steamworks metrics to capture from GJ, and what benchmarks to compare against

### Takeaway
Instrument these from day one of the Coming Soon page:
- Impressions and CTR, split by traffic source (Traffic Breakdown)
- Visit-to-wishlist conversion
- Wishlist adds, deletes and conversions (Wishlist report)
- UTM visits and conversions per external channel
- Followers
- Refund rate and reasons
- Review count and velocity, with time to 10 reviews
- Regional split
- Event/festival lift

Benchmarks are mostly community estimates, not Valve data:
- CTR: about 2–4% is average for an indie, 4–7% good, 7%+ excellent
- Visit-to-wishlist: about 8–15% median
- Sales per wishlist: deflated to about 0.22 first-month sales per wishlist for 2023–25 releases

### Cited Findings
- **UTM analytics (Steamworks).** It tracks Total, Trusted and Tracked Visits. For tracked (logged-in) visits it also records wishlists, purchases and activations within **72 hours** of the click.
  - Dashboard updates hourly. Conversions are finalized 4 days after the visit.
  - Only app and sale pages are supported, not developer homepages or bundles.
  - Social in-app browsers and switching browser or device break attribution.
  - Refunds after 4 days aren't reflected.
  - CSV export is available. Requires the "View Marketing Traffic Data" permission.
  - — [Steamworks UTM Analytics](https://partner.steamgames.com/doc/marketing/utm_analytics)
- **CTR tiers** (vendor estimate): under 2% poor, 2–4% indie average, 4–7% good, 7%+ excellent. Valve warns an impression only means the capsule was displayed on screen, not that the player saw it. Some impression types can't produce a click at all. — [Steam Page Analyzer, CTR benchmarks](https://www.steampageanalyzer.com/blog/steam-ctr-benchmarks)
- **Visit-to-wishlist** (vendor estimate): median 8–12% (other pages on the same site say 8–15%). 12–18% is good and over 25% exceptional. The vendor admits no public dataset covers this by genre at scale, and its own pages are inconsistent. — [Steam Page Analyzer, conversion benchmarks](https://www.steampageanalyzer.com/blog/steam-store-page-conversion-benchmarks); [Steam Page Analyzer, by genre](https://www.steampageanalyzer.com/blog/steam-conversion-rate-by-genre)
- **Wishlist inflation (Zukowski, 13 Oct 2026, n = 34 titles from 2020–22 vs. 126 from 2023–25):**
  - First-month sales per wishlist: 0.45 → 0.22
  - Six-month sales per wishlist: 0.82 → 0.43
  - One-year sales per wishlist: 0.99 → 0.70
  - Launch-wishlist-to-first-month-sales R² stays high: 0.77 → 0.72
  - Wishlist velocity R² is 0.70, or 0.75 combined with total wishlists
  - Causes: hover-tooltip wishlisting and festival wishlists that convert worse
  - GameDiscoverCo median first-week sales: 0.15x launch wishlists (2024–25 games with 25k+ wishlists)
  - — [Inven Global, 15 Oct 2026](https://www.invenglobal.com/articles/27273/steam-wishlist-inflation-value-of-1-wishlist-cut-in-half-but-predictive-power-remains-unchanged); [wnhub summary](https://wnhub.io/news/analytics/item-52409)
- **Followers.** Following a game puts the player in a mostly hidden group. Your events and announcements appear in followers' Activity Feed and News Hub. The count is visible at steamcommunity.com/games/<appid>/membersManage. — [Steamworks, Followers](https://partner.steamgames.com/doc/marketing/followers)
- **Followers-to-wishlists ratio.** A commonly cited community heuristic is roughly 1 follower per 10 wishlists (vendor source). — [Steam Page Analyzer, followers vs wishlists](https://www.steampageanalyzer.com/blog/steam-followers-vs-wishlists)
- **Review thresholds.**
  - Under 10 reviews, a game shows no review score. This is visible in the Steam UI.
  - The claim that games under 10 reviews are kept off discovery comes from secondary sources.
  - Reviews from free-key recipients don't count toward the score.
  - A score at 40% or higher reportedly doesn't hurt visibility. Valve has reportedly said the algorithm only suppresses Mostly Negative and below (secondhand).
  - Language-specific scores (2025 change) have higher thresholds than 10.
  - — [Automaton](https://automaton-media.com/en/news/steam-developers-need-your-review-more-than-you-think-even-if-its-literally-just-one-word/); [howtomarketagame, first 10 reviews (2022, older)](https://howtomarketagame.com/2022/01/25/why-your-first-10-reviews-are-the-most-important/); [Dexerto](https://www.dexerto.com/gaming/new-steam-update-changes-how-review-scores-work-3239745)
- **Further review thresholds** at 50 and 500 reviews and a 70% line are claimed by a vendor (FirstLook). — [FirstLook](https://firstlook.gg/blog/how-many-steam-reviews-does-your-game-need-at-launch)
- **Base rates for 2025 releases** (secondary, citing SteamDB and Alinea): 48.7% finished their launch year under 10 reviews, and about 1.5% grossed $1M+. — [Steam Page Analyzer, median Steam game 2026](https://www.steampageanalyzer.com/blog/median-steam-game-2026)
- **Release volume:** about 14,000 new Steam releases in 2023, nearly 21,000 in 2025 (SteamDB, via Inven). — [Inven Global](https://www.invenglobal.com/articles/27273/steam-wishlist-inflation-value-of-1-wishlist-cut-in-half-but-predictive-power-remains-unchanged)

### Inferences
- **GJ metric sheet (weekly):**
  - Impressions and CTR, split by source
  - Page visits and visit-to-wishlist rate
  - Wishlist adds and deletes
  - UTM table per channel (Discord, Reddit, newsletter, press, YouTube)
  - Followers
  - Units, refund rate and refund reasons
  - Reviews: count, % positive, days to 10
  - Top-10 countries
  - Any event/fest spike
- Compare GJ's numbers against GJ's own Meta funnel (1.7% CTR, 11.3% page-to-purchase) and the community tiers above, but tag every number "VR-filtered." The SteamVR audience is about 1.35% of Steam (see Q5), and the store limits visibility for VR-only titles, so impression counts will be structurally low.
- The 10-review gate matters most for GJ. With roughly 9 lifetime Quest ratings, reaching 10 genuine Steam purchaser reviews quickly is a real launch-ops test. Free keys don't count, so curator/press keys won't get it there.
- The most transferable measurement habit is UTM-tagging every CMP-owned link. It tells PlayPen which owned channels actually drive logged-in Steam conversions.

### Gaps
- Valve doesn't publish CTR or conversion benchmarks, so no authoritative figure exists. I found no VR-specific CTR or wishlist-conversion benchmark.
- Refund-rate norms: I found no reliable 2024–26 benchmark in this pass. Steam's refund policy itself (14 days / under 2 hours played) is well known but wasn't re-verified here.
- Next Fest attribution metrics weren't researched in depth (Zukowski notes festival wishlists convert worse).

## 3. Process learnings to rehearse on GJ

### Takeaway
GJ is a low-stakes rehearsal for every Steamworks rule that will bind PlayPen. The most important rules are the two-week Coming Soon minimum, launch-discount mechanics and 30-day cooldowns, seasonal-sale eligibility, the 10-review score gate (free keys don't count), and event/announcement cadence.

### Cited Findings
- **Coming Soon page.** A new product must have a Coming Soon page live for at least two weeks before release. Valve advises publishing it as soon as you're ready to talk publicly. — [Steamworks, Coming Soon](https://partner.steamgames.com/doc/store/coming_soon) (as summarized in search results)
- **Launch discount:**
  - Runs 7–14 days and starts at release
  - Valve suggests about 10–15%, with a 40% cap
  - Must be set up **before** release
  - — [Steamworks, Discounting](https://partner.steamgames.com/doc/marketing/discounts)
- **Cooldowns:**
  - No discount for 30 days after release (launch discount excepted)
  - No discount for 30 days after a price increase
  - 30 days required between discounts
  - No base-price increase within 30 days of release
  - Discounts run 10–95% off, for 1–14 days
  - Seasonal sales have no cooldown, but a product still in its release or price-increase cooldown can't join one
  - — [Steamworks, Discounting](https://partner.steamgames.com/doc/marketing/discounts)
- **Bundles.**
  - You can bundle any titles for which you hold "Manage pricing and discounts" permission. Developer and franchise packs are typical examples.
  - "Complete the Set" charges only for the items the buyer doesn't own.
  - Maximum discount is 95%. Each package must stay above the $0.49 minimum (Complete the Set); Must Purchase Together totals at least $0.58.
  - Valve suggests releasing a bundle after all its products are released.
  - — [Steamworks, Bundles](https://partner.steamgames.com/doc/store/application/bundles)
- **Next Fest.** Zukowski's 2026 analysis still says to do the last Next Fest before launch. Elsewhere he recommends saving the "announce" as a distinct beat that content platforms can feature. — [howtomarketagame, Feb 2026 Next Fest](https://howtomarketagame.com/2026/04/13/making-sense-of-the-february-2026-steam-next-fest/); [howtomarketagame, double jump trick (2024)](https://howtomarketagame.com/2024/06/18/the-double-jump-trick-to-steam-next-fest/)
- **Wishlist email on discounts.** Wishlisters get an email and a client notification at launch, at Early Access exit, and when the game goes on sale at 20% or more (third-party summary of Steam docs). — [presskit.gg, how wishlists work](https://presskit.gg/field-guides/how-steam-wishlists-work)

### Inferences
- **Rehearsal checklist for GJ:**
  - Page review turnaround
  - Build review and the default/beta branch flow
  - Launch-discount setup before release
  - Planning the first post-launch discount for at least day 31
  - Opting into the next seasonal sale through the Discount Management Dashboard
  - Posting events: a launch event, then patch/update events, and measuring follower Activity Feed views
  - Curator Connect and key distribution (Keymailer/Lurkit). Response rate is the process metric, not a review-count lever.
  - A defined plan to get 10 genuine paid reviews (Discord community, existing Quest owners)
- A seasonal sale needs no cooldown, but a product still in its 30-day post-release window can't join one. GJ's release date should therefore be picked so the first seasonal sale it can join falls after day 30.

### Gaps
- I didn't verify current Steam Curator Connect, Keymailer or Lurkit specifics (pricing, typical response rates) in this pass.
- No data on the Steam store-review or build-review turnaround times for 2026.

## 4. Cross-promotion mechanisms between two games from one developer on Steam

### Takeaway
The Developer/Publisher Creator Homepage is the one Valve-native mechanism that emails followers when a new game launches. Creator Homepage followers are therefore the most valuable cross-genre asset GJ can grow, alongside CMP's off-Steam mailing list and Discord. Other levers:
- A cross-promotion event or announcement in GJ linking to PlayPen
- A PlayPen link or widget in GJ's "About This Game"
- Creator Homepage lists/franchise pages
- Bundles, but only after both games are released

I found no quantitative evidence of how much any of these move sales.

### Cited Findings
- **Creator Homepage followers:**
  - They "will receive an email when your game launches or enters early access or exits early access."
  - A product page shows "you follow this developer/publisher" as a relevance reason.
  - Steam may surface developers/publishers/franchises on the front page and in hub capsules.
  - Lists can group games, either long-term (franchise) or temporary (promotion).
  - A new game appears on linked homepages automatically once it's approved as "coming soon."
  - Linking is done via the Basic Info "link" button or the Creator Homepage Setup tool.
  - — [Steamworks, Developer and Publisher Homepages](https://partner.steamgames.com/doc/store/creator_homepage)
- Following a game (as opposed to a creator) does NOT reliably email on launch or discount, per third-party guides. Followers get feed updates only. Steam community users report receiving developer/publisher emails, which confirms creator-follow emails exist. — [presskit.gg, followers vs wishlists](https://presskit.gg/field-guides/steam-followers-vs-wishlists); [Steam Community thread](https://steamcommunity.com/discussions/forum/10/2793871682812340622/)
- Zukowski's "60 Mistakes" ebook (2023) recommends:
  - Creating a "cross promotion" event in the old game that announces the new game and links to it
  - Adding the new game's store URL to the old game's "About This Game," where Steam auto-renders a wishlist widget
  - — [Zukowski, 60 Game Marketing Mistakes (PDF, 2023)](https://howtomarketagame.com/wp-content/uploads/2023/05/Zukowski_60MistakesEbookV1.pdf) (via search summary)
- UTM analytics doesn't track developer-homepage or bundle pages. Cross-promo links must point at the app page to be measured. — [Steamworks UTM](https://partner.steamgames.com/doc/marketing/utm_analytics)

### Inferences
- **Do now:**
  - Create the CMP Creator Homepage and link GJ to it before GJ's Coming Soon page goes live
  - Add a "Follow Corrupted Media on Steam" call to action in GJ's events, credits/menus and Discord
  - Once PlayPen's page exists, link it in GJ's About section (widget) and post a cross-promo event in GJ with UTM-tagged links
- Expect small absolute numbers. A PC VR shooter buyer is an unlikely 2D-puzzle buyer, so the homepage email is a low-cost nudge rather than a launch driver. The off-Steam list and Discord matter more because CMP can segment and re-pitch them.
- **"More from this developer" shelf.** The Steamworks pages I reviewed don't document this shelf directly. Its behavior is assumed from the store UI and should be checked on a live page.

### Gaps
- No public data quantifies homepage-follower email open/conversion rates, or the uplift from cross-promo events or "more from developer" shelves.
- I found no documented franchise-page or cross-game sale-event case study with numbers for a two-game indie.

## 5. PC VR on Steam: market reality 2025–26 (setting GJ expectations)

### Takeaway
PC VR on Steam is small and flat-to-shrinking:
- About 1.35% of surveyed Steam accounts had a VR headset in September 2026, and Quest devices dominate that share.
- In 2025, most new paid VR games outside sim, sports, shooter and simian genres sold "a few thousand units at best."
- Developer-reported Quest:Steam revenue splits typically range from 70:30 to 90:10.

Shooters are one of the better-selling VR genres. Even so, a three-year-old $10 Quest port with about 9 Quest ratings should expect hundreds to low thousands of Steam units. Neither a good nor a bad result says much about PlayPen.

### Cited Findings
- **Steam Hardware Survey, Sept 2026** (secondary reports):
  - About 1.35% of surveyed accounts have a VR headset, down 0.14 points
  - Quest 3 at 26.90% of VR, Quest 2 at 25.80%, Quest 3S at 11.07%, Valve Index at 10.83%
  - Valve's Steam Frame appears for the first time at 0.41%; it went on sale Sept 14 at $1,059
  - Valve publishes shares only, never absolute counts
  - — [Digital Citizen](https://www.digitalcitizen.life/meta-quest-3-retakes-top-spot-steam-hardware-survey-september-2026/); [vr.org](https://vr.org/articles/steam-frame-first-steam-survey-reading-0-41-percent-september-2026)
- **GameDiscoverCo (2025):**
  - Only **four paid VR-only Steam titles sold over 100k copies in 2025**, Gorilla Tag ($20) among them
  - Most new paid VR games outside the sim/sports/shooter/simian genres sold "a few thousand units at best"
  - Ghosts of Tabor: about 300k units on Steam, under 20k on PSVR, low millions on Quest
  - Quest users spend about 70% of their time in F2P
  - Reality Labs layoffs; Cloudhead cutting 70% of staff
  - — [GameDiscoverCo, What happened to VR games in 2025](https://newsletter.gamediscover.co/p/what-happened-to-vr-games-in-2025)
- **UploadVR (5 Feb 2025), anonymous developers:**
  - Typical split "90% Quest — 10% Steam"; another reports Steam 22% / Meta 78% after 6 weeks
  - One CEO reports 90% of sales on Steam thanks to front-page features during themed sales/festivals
  - One says Steam 2024 sales beat 2023 and 2022, and another says the gap is "shrinking"
  - Kevin Walker (Middle Man Games): Steam has "a much lower reach but it's a much bigger pond"
  - Some non-subscription devs saw 2024 revenue fall 50–80% vs. 2023 (unattributed)
  - Into the Radius 2 earned about $3M in Steam Early Access
  - GDC survey: 59% of VR devs target Quest, 31% SteamVR
  - — [UploadVR, From Quest to Horizon](https://www.uploadvr.com/from-quest-to-horizon-how-metas-shifting-priorities-are-affecting-developers/)
- **Eye of the Temple** (Steam 2021 → Quest 2023, reverse direction):
  - About 70% of lifetime revenue from Quest
  - Quest week one was about 2x Steam's week one
  - Steam year one covered 40% of the dev budget
  - Developer notes 2021–22 dev chatter that Quest sold 5–10x Steam
  - — [UploadVR, Jan 2024 (older)](https://uploadvr.com/eye-of-the-temple-quest-steam-sales)
- **Older baseline:** GameDiscoverCo's 2022 VR dev survey found a median/average of 84% of lifetime revenue from the Meta store. — [GameDiscoverCo, state of VR 2022 (older)](https://newsletter.gamediscover.co/p/the-state-of-vr-games-in-2022-survey)
- **Meta 2025:** record Quest users and 100+ apps over $1M gross, but Horizon Store developer revenue only "very slightly" up vs. 2024. — [Road to VR](https://roadtovr.com/meta-quest-record-users-2025-100-apps-1-million); [UploadVR](https://uploadvr.com/meta-says-2025-saw-record-quest-users-more-than-100-apps-made-over-1-million)

### Inferences
- If GJ's Quest-to-Steam ratio follows the typical 70:30–90:10 pattern, GJ's Steam lifetime revenue would be a fraction of its (already modest) Quest revenue unless it lands Steam featuring (seasonal or VR fests).
- Steam Frame's launch (Sept 2026) is a possible small tailwind, since new hardware owners look for content. It's too early to quantify.
- Write the "do not over-read" rule into the plan: GJ's absolute sales, wishlists and CTR are not evidence about PlayPen's market. Only process outcomes and owned-channel responsiveness are.

### Gaps
- I found no published sales numbers for a Quest-first game ported to Steam in 2024–26.
- I found no VR-specific Steam median-revenue figure.
- Survey figures are secondhand. The official Valve hwsurvey page wasn't opened directly.

## 6. Test the market cheaply: PlayPen's Steam page as the traction test (CMP board rule, Aug 2026)

### Takeaway
Zukowski's guidance is to put a Steam page up as early as you can show the genre and art style, then read wishlist velocity.

His 2021 benchmark (older, n=58) for wishlists gained in the first two weeks:

| Tier | First-two-week wishlists |
|---|---|
| Underperforming | 25–148 |
| Natural visibility | 150–269 |
| Strong hook | 270–965 |
| Top tier | 1,000+ |

Low numbers mean "adjust," not "dead." Wishlists now convert at about half their old rate, so read these tiers conservatively. For PlayPen, the page's own early velocity and visit-to-wishlist rate (vs. about 8–15%) are the cleanest traction test available. GJ's numbers are not.

### Cited Findings
- **Zukowski's 2021 study (58 games), first-two-week wishlists after Coming Soon:**
  - The four tiers are as in the table above
  - Underperformers usually have graphics problems or are in a genre unpopular on Steam
  - Low numbers are "not a death sentence"; one game in the survey sold well despite 54 two-week wishlists
  - Steam doesn't penalize a weak first two weeks
  - — [Game World Observer (2021, older)](https://gameworldobserver.com/?p=13057); [wnhub summary](https://wnhub.io/news/analytics/item-4249)
- **Launch the page early.** A post can go viral at any time, and without a page those wishlists are lost. Also: commit to one genre and settle the art style before the page goes up. — [Game World Observer, Mar 2025](https://gameworldobserver.com/2025/03/11/steam-page-launch-guide-wishlists-zukowski)
- **Wishlist velocity** predicts first-month sales (R² 0.70 for 2023–25). Total wishlists are slightly better, and the two combined reach 0.75. Each wishlist is worth about 0.22 first-month sales now. — [Inven Global, Oct 2026](https://www.invenglobal.com/articles/27273/steam-wishlist-inflation-value-of-1-wishlist-cut-in-half-but-predictive-power-remains-unchanged)
- **Wishlist quality.** GameDiscoverCo argues festival and hover wishlists are lower quality. — [GameDiscoverCo, wishlist quality](https://newsletter.gamediscover.co/p/we-need-to-take-wishlist-quality); [GameDiscoverCo, state of wishlist conversions](https://newsletter.gamediscover.co/p/the-state-of-steam-wishlist-conversions)
- **Save the reveal.** Zukowski also advises saving the formal "announce" as a beat for coverage. — [howtomarketagame, double jump (2024)](https://howtomarketagame.com/2024/06/18/the-double-jump-trick-to-steam-next-fest/)

### Inferences
- **Proposed go/no-go for PlayPen.** These thresholds are an inference anchored on Zukowski's tiers, not a published rule. They assume the art overhaul is far enough along that capsule and screenshots represent the final look; Zukowski's art-style rule means a placeholder-art page would test the wrong thing.

  | Signal (over a defined push, e.g. announce + one Reddit/Discord round) | Read |
  |---|---|
  | Under ~150 wishlists in the first 2 weeks | Rework hook or art before committing more production |
  | ~270+ in 2 weeks | "Hook" tier, meets the board rule |
  | 1,000+ in 2 weeks | Strong signal |

- **Pair the count with rates:**
  - Visit-to-wishlist at or above about 10%
  - CTR at or above about 3–4%
  - Velocity sustained over 2–3 months, not just the announce spike
- The free browser build is itself a traction instrument. UTM-tag every Steam link from it and track browser-to-wishlist conversion.

### Gaps
- No recent (2024–26) re-run of the two-week tier study was found. The 2021 tiers predate wishlist inflation.
- No published puzzle-platformer-specific wishlist-velocity benchmarks.

## 7. Should PlayPen's Coming Soon page go up BEFORE GJ launches?

### Takeaway
On balance, yes, if PlayPen's art can carry a page. The sequence:
1. Create the CMP Creator Homepage now.
2. Put PlayPen's Coming Soon page up before or at GJ's launch, so GJ's launch traffic, About-section widget and launch event can point at it.
3. Hold a bigger "announce" beat (trailer, press push, a Next Fest) for later.

Evidence that GJ traffic will convert to PlayPen wishlists is weak given the audience mismatch, so the main benefit is not missing incidental wishlists. Valve's two-week minimum is easy to meet.

### Cited Findings
- Valve: publish the Coming Soon page as soon as you're ready to talk about the game, with a two-week minimum before release. — [Steamworks, Coming Soon](https://partner.steamgames.com/doc/store/coming_soon)
- Zukowski: launch the page early so a viral moment doesn't waste wishlists. But commit to the art style first, because the first screenshots must communicate it. — [Game World Observer, Mar 2025](https://gameworldobserver.com/2025/03/11/steam-page-launch-guide-wishlists-zukowski)
- Zukowski recommends a cross-promo event in the old game plus a new-game link in "About This Game" (auto widget). — [60 Mistakes ebook (2023)](https://howtomarketagame.com/wp-content/uploads/2023/05/Zukowski_60MistakesEbookV1.pdf)
- A launch playbook suggests using the current release to tease the next game. Others warn that announcing during a launch risks splitting focus, and recommend about 6–12 months between announce and launch for a first commercial title. — [playruo launch playbook](https://playruo.com/blog/game-launch-marketing-strategy-complete-playbook); [presskit.gg, how to announce](https://presskit.gg/field-guides/how-to-announce-indie-game)
- Wishlists largely don't age, so an early page doesn't "waste" wishlists. The caveat is a later big change in genre or tone. — [howtomarketagame, Do wishlists get old (Jan 2025)](https://howtomarketagame.com/2025/01/27/do-wishlists-get-old/)

### Inferences
- **Recommended order:**
  1. CMP Creator Homepage now, with GJ linked to it
  2. PlayPen Coming Soon page once the overhauled art covers capsule, 5+ screenshots and 3 environments (this doubles as the board-rule traction test)
  3. GJ launch, with a PlayPen widget in About, a PlayPen cross-promo event, and "follow CMP" calls to action
  4. GJ seasonal sale(s), each with another PlayPen mention
  5. PlayPen's formal announce/trailer beat and a Next Fest closer to its launch
- **If PlayPen's art isn't page-ready by GJ's launch, don't rush it.** A placeholder-art page mis-tests the board rule and violates Zukowski's art rule. The GJ cross-promo event can be posted later; the About widget can be added anytime.
- **Risk:** splitting a solo dev's attention during GJ launch week. Mitigate by preparing the PlayPen page and events in advance so launch week is ops only.

### Gaps
- I found no data quantifying how many wishlists a next-game page gains from a different-genre predecessor's launch traffic.
