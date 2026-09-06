# ARBESTRA — Context for Astra

> Note de reprise, 2026-09-05 : document historique d'intention, non exhaustif des décisions ultérieures. Pour l'état courant et les règles de travail, lire [SESSION-HANDOFF.md](../SESSION-HANDOFF.md) et [AGENTS.md](../AGENTS.md). Les décisions explicites ultérieures de Tristan et la spec de la tranche active priment sur les intentions anciennes ci-dessous.

> **Purpose of this document**  
> This is not a specification and not a README. It is a context-transfer note for an AI/model reviewing the Arbestra repository. It summarizes the project's genealogy, the technical and product directions already discussed, the deliberately absurd worldbuilding ideas that may have architectural consequences, and the areas where a critical external review is wanted.
>
> Treat the repository as the source of truth for what is actually implemented. Treat this document as the source of truth for **intent, history and direction**. If the code contradicts this note, call it out explicitly instead of silently rationalizing the mismatch.

---

## 1. Executive summary

Arbestra is an independent web strategy game project born out of work around a hypothetical **Waar v3**.

The important distinction is that Arbestra is a **genealogical fork, not a legacy-preservation project**. It inherits experiments, lessons, mechanics worth reusing, and some technical work — especially around the combat simulation — but it is not supposed to reproduce Waar's architecture, UX or historical gameplay by default.

The project is intentionally being started with a clean modern stack and a small amount of infrastructure:

- TypeScript end-to-end where practical;
- React for HUD/application UI;
- Babylon.js for the actual game world;
- Fastify for the authoritative backend;
- PostgreSQL as the source of truth;
- a deterministic Rust combat engine with explicit seeds;
- a pnpm + Cargo monorepo;
- HTTP/JSON first, SSE where useful;
- no Redis or distributed-systems cosplay until the game actually needs it.

The product target is a **single responsive web client** for desktop, tablet and phone, rendering a real 3D world with an isometric / 2.5D reading rather than a fake 2D scene.

The project is conceived as free-to-play and without advertising, with public/forkable code being considered, while commercial exploitation, branding, lore and assets may remain separately controlled.

There is a deliberate tension in the project:

1. **Do not overarchitect a game that is still finding itself.**
2. **Do not accidentally bake flat-world, legacy-combat or desktop-only assumptions so deeply into the first implementation that the interesting ideas become expensive later.**

The purpose of this review is largely to identify that boundary.

---

# 2. Genealogy: Waar -> v3 experiments -> Arbestra

## 2.1 Waar as the antecedent

Waar is an existing browser strategy game with a relatively small military model and a legacy codebase/gameplay loop.

The initial work around a possible v3 was not merely visual modernization. It quickly became a research project into what a cleaner game architecture and a more expressive combat system could look like.

Important inherited observations:

- the military system only needs a small number of unit archetypes to generate interesting behaviour;
- combat can be modeled as interactions between cohorts rather than simulating every soldier as an entity;
- deterministic seeded simulation is extremely valuable for debugging, calibration and replay;
- balancing by intuition alone is inadequate once counters, target preferences, random effects and wounded units interact;
- a dedicated simulation laboratory is more useful than trying to infer balance from production gameplay.

During this phase, a combat engine was moved toward / implemented in **Rust** so that very large numbers of combats could be run quickly and reproducibly.

The resulting tooling became informally known as the **soufflerie**: a wind tunnel for rulesets.

## 2.2 The break with legacy preservation

At first, part of the work attempted to compare a candidate v3 ruleset against Waar's historical behaviour.

That eventually became the wrong objective.

The direction changed from:

> “Make the new engine reproduce the legacy game closely enough.”

into:

> “Use the new engine to find a good initial ruleset for the new game.”

This is a major conceptual break.

Legacy Waar is now best understood as:

- a source of lessons;
- a source of test cases;
- sometimes a useful baseline;
- **not** an architectural contract;
- **not** a gameplay contract;
- **not** something Arbestra must remain compatible with unless there is an independent reason to do so.

Arbestra therefore has permission to simplify aggressively.

If something exists in the repo only because “Waar did it that way”, that is a valid review target.

---

# 3. Product direction

## 3.1 What Arbestra wants to be

Arbestra is a persistent online strategy game played through a web client.

The broad ambition is closer to a living spatial world than to a spreadsheet with a village illustration bolted on top.

Core product principles discussed so far:

- one web application across desktop, tablet and mobile;
- real spatial representation of the village/world;
- authoritative server state;
- actions that exist in actual time rather than an hourly-cron worldview;
- world geography that can matter mechanically;
- understandable mechanics with enough systemic interaction to reward experimentation;
- low barrier to entry, but not necessarily a flat or trivial simulation;
- free-to-play;
- no advertising;
- avoid manipulative engagement machinery and fake-population nonsense;
- open/forkable code is desirable, but that does not automatically imply giving away commercial rights to the complete game identity/assets/lore.

## 3.2 Things Arbestra is not trying to optimize for yet

It is **not** currently useful to optimize for:

- hyperscale;
- microservices;
- multi-region deployment;
- speculative queues everywhere;
- a general-purpose MMO engine;
- an ECS religion;
- perfectly abstract support for every imaginable world topology;
- premature multiplayer synchronization complexity before the core village loop is good.

A recurring rule for the project is:

> Build enough architecture to protect known important seams, but no more.

---

# 4. Current technical direction

## 4.1 Repository / stack

The intended architecture is a monorepo using **pnpm + Cargo**.

The exact folder names may have moved during implementation, but the conceptual split is:

- web client(s);
- API;
- shared transport/contracts package;
- Rust combat engine crate;
- database migrations;
- architecture/game-design documentation.

The stack direction is:

### Client

- TypeScript
- React
- Babylon.js
- Vite

React owns application/HUD UI.

Babylon owns the world scene.

The separation matters. React should not gradually become a per-frame scene graph, and Babylon should not become the application framework.

### Server

- TypeScript
- Fastify
- PostgreSQL

The server is authoritative.

PostgreSQL is the source of truth.

Initial communication should stay boring:

- HTTP/JSON for commands and reads;
- SSE where push updates materially improve the experience;
- no Redis by default;
- internal polling / delayed-action processing is acceptable initially if it is explicit, bounded and does not generate pathological write traffic.

### Contracts

Shared transport contracts should be explicit and versionable.

TypeBox or equivalent schema-driven contracts have been preferred over informal duplicated TypeScript interfaces.

Do not let “shared types” accidentally couple persistence models, game-domain models and wire formats into one object graph.

---

# 5. Persistence and world identity

The current preferred persistence model is a **single PostgreSQL database**, with world-scoped data keyed by `world_id` rather than one database per world.

Account identity is global; game identity/state is per world.

The architecture should make it plausible to run multiple worlds without turning every query into a footgun.

Particular audit questions:

- Is `world_id` consistently part of the data model where needed?
- Can cross-world leakage happen accidentally?
- Are uniqueness constraints world-aware?
- Do domain/service boundaries make world context explicit enough?
- Are delayed actions idempotent?
- Is the DB being mutated during nominally read-only polling?

One concrete issue already observed during development was **polling causing repeated UPDATEs several times per second on reads**. That is exactly the kind of accidental behaviour the architecture should make difficult.

Another concrete issue already found: **tests were able to overwrite/use the development database because the test DB configuration could fall back to the normal `DATABASE_URL`.** A hard guard and truly separate test database are expected.

---

# 6. The world: real 3D, read as 2.5D

## 6.1 Visual direction

The client should render a **real 3D scene**, but with a clear strategy-game/isometric reading.

Think less “free-flying 3D game camera” and more “Age-of-Empires-like spatial legibility backed by actual geometry”.

Reasons for using real 3D:

- camera freedom later;
- proper height/occlusion;
- cleaner construction stages and modular buildings;
- future world curvature/topology tricks;
- lighting and atmosphere;
- avoiding a dead-end fake-2.5D implementation that later has to be replaced.

The goal is still web performance on phones.

Therefore the review should be suspicious of:

- one Babylon mesh per trivial tile/object;
- unnecessary per-frame JS work;
- projecting/serializing every interactive tile at high frequency;
- CPU-side interaction heuristics where native picking can do the job;
- expensive decorative effects being added before they earn their cost;
- scene/UI coupling that makes performance work hard later.

A recent client profiling pass already found examples of this class of issue: too many independently evaluated scene objects, frequent reprojection/serialization of interactable cells, and approximate screen-distance click targeting instead of exact Babylon picking.

The intended correction is generally to use the engine's actual spatial primitives rather than reimplementing them in application code.

## 6.2 Terrain / occupancy model

Current world-generation ideas include:

- sparse atomic occupancy;
- deterministic terrain generation;
- chunks around 32x32;
- terrain types such as prairie, water and rock;
- wooded cells / rock outcrops as server-side features where relevant;
- protected clearings for player starts;
- transactional generation;
- an initial building radius based on Chebyshev distance (currently discussed around radius 5).

The distinction between **server-significant features** and **purely cosmetic scene decoration** should remain explicit.

Do not make the database remember every flower merely because Babylon rendered it.

---

# 7. Combat engine: the Rust core and the “soufflerie”

This part predates the Arbestra name but is one of the strongest candidates for reuse.

## 7.1 Philosophy

The combat engine is meant to be:

- independent from the web framework;
- deterministic given the same inputs + seed;
- batchable;
- fast enough to run large Monte-Carlo/calibration campaigns;
- versionable;
- inspectable;
- callable by the game server without dragging game persistence into Rust.

It should be possible to run it from a CLI/test harness without booting the web application.

The engine boundary is a feature, not an inconvenience.

## 7.2 Model explored so far

The explored ruleset has approximately four unit types and supports concepts such as:

- attack;
- structure / survivability;
- cost;
- precision / probabilistic hit behaviour;
- counter relationships;
- target priorities;
- simultaneous or cohort-based strikes;
- multiple rounds;
- wounded units that may still fight;
- surrender / termination thresholds;
- probabilistic infirmary/recovery mechanics;
- “ExtraBall”-style secondary attacks/effects;
- generation/depth tracking for those chained effects.

The exact names and formulas are **not sacred**.

The important thing is that the engine can express interactions cleanly and the lab can reveal emergent balance.

## 7.3 The soufflerie

The simulation lab runs armies against one another, often with equal resource budgets, and visualizes the outcome as comparative vectors/metrics.

The working balancing intuition became:

- start with full/single-archetype armies because they are easier to reason about;
- seek short, clean, interpretable vectors before testing mixed armies;
- filters are important so only relevant army pairs are simulated/displayed;
- do not waste CPU simulating pairs the analyst did not ask to inspect;
- use fixed seeds / matching seeds when comparing two rulesets;
- then move toward mixed compositions and more complex interactions.

A desired high-level counter structure has been something like:

> full Soldat > full Chevalier > full Lancier > full Soldat

—not as a dogma, but as an example of a readable strategic triangle.

An important bug/insight during early calibration was that all units had effectively started from the same neutral baseline (`Attack 10 / Structure 10 / Cost 20 / Precision 0.2`). That made some intended counter behaviour mathematically impossible or misleading until the actual differentiating parameters were introduced.

## 7.4 Performance / boundary

A profiling run of the earlier Symfony-hosted lab showed that the Rust batch itself was doing useful work efficiently; much of the surrounding latency came from framework bootstrap/security/dev-mode overhead.

The lesson for Arbestra is not “optimize every microsecond”. It is:

> Preserve a coarse, batch-oriented boundary between the game process and the Rust engine. Never regress into one expensive FFI call per micro-event or per soldier.

The engine should return complete structured results suitable for analysis, logs and later replay/debugging.

---

# 8. Geometry nonsense that may become real design

This section is intentionally here.

Some of the “jokes” have enough structural value that they should not be forgotten when evaluating architecture.

## 8.1 Toroidal world / donut

A baseline idea is a world that wraps in both axes — topologically a torus.

At ordinary game zoom, the player experiences an apparently continuous terrain.

At sufficiently wide zoom, the game could reveal the actual world as a **donut**.

Consequences / ideas discussed:

- wraparound movement is not just a map-edge hack; it is lore-visible geometry;
- between two locations there can be multiple routes around the torus;
- the player may initially choose the bad/long route;
- the game can later suggest something like **“hire a cartographer”** rather than magically correcting every path;
- distance/pathfinding APIs should therefore avoid assuming that Euclidean planar distance is the only valid notion of distance.

This does **not** mean implementing a generic topology framework today.

It does mean: avoid hardcoding `sqrt(dx² + dy²)` or unwrapped Cartesian assumptions into every domain object if a small seam can contain them.

## 8.2 Internal eclipse

One memorable visual consequence of the torus discussion:

A sun/light trajectory can produce an **eclipse that passes through / across the interior of the torus**.

This began as a slightly ridiculous geometric consequence and immediately became attractive as world identity.

If lighting/celestial systems later exist, world topology could have visible consequences rather than being purely mathematical.

No need to implement this now.

But do not accidentally make the sky/lighting model impossible to decouple from a flat-world assumption either.

## 8.3 Even worse possible worlds

Other deliberately exploratory ideas have included:

- cube-like worlds with strange wrapping / infinite-scroll presentation;
- multiple worlds using different topologies;
- **two toroidal worlds intersecting on different axes**;
- eclipses/occlusions caused by one world relative to another;
- variable “spacetime” or traversal relations between worlds.

These are ideas, not roadmap commitments.

The architectural takeaway should be modest:

> Keep the spatial model behind a sane boundary. Do not build topology algebra before the village works, but do not spread flat-map assumptions through business logic if one service/module can own distance, wrapping and route semantics.

---

# 9. The Oracle and tone

A recurring worldbuilding device is **the Oracle**: an omniscient-ish narrator/system voice that can be capricious, incomplete, sarcastic or selectively helpful.

This solves several design problems at once:

- tutorial information can exist diegetically;
- uncertainty can be part of the fiction;
- the game does not need a perfectly neutral omniscient UI for every mechanic;
- strange world geometry can be explained in-character;
- hints such as the cartographer example can feel like part of the world instead of generic UX copy.

Arbestra's tone is allowed to have personality.

The project should not accidentally become a sterile enterprise dashboard with trees.

---

# 10. Buildings and asset pipeline

The current visual plan is low-poly 3D with reusable modular kits.

Blender is expected to be the natural asset-authoring tool rather than generating final building geometry procedurally in Babylon.

For a building, the useful state decomposition discussed is roughly:

1. beginning of construction;
2. middle of construction;
3. end of construction;
4. completed level 1;
5. modular additions/variants for higher levels.

This is preferable to requiring a wholly unique model for every level.

The first explicit building used to explore the pipeline was a **sawmill/scierie**.

The broader desired asset kit includes reusable pieces such as:

- timber/framing;
- roofs;
- planks;
- stone;
- logs;
- vegetation variants.

Babylon remains responsible for assembly, placement, variation and runtime state, not for replacing Blender as a mesh modeller.

AI-assisted asset generation can be useful, but should ideally produce or accelerate a maintainable kit rather than a collection of opaque one-off meshes.

---

# 11. Recent implementation state worth knowing

At a recent milestone, the repository had established the beginnings of world/economy foundations with green PostgreSQL tests and working desktop/mobile E2E coverage.

A development setup was running separate web/API services and a test/dev workflow.

The details will obviously be more current in the repo than in this note, so inspect the actual state rather than trusting historical numbers.

Recent classes of issue already discovered include:

- dev DB being exposed to tests via configuration fallback;
- polling causing repeated unnecessary writes;
- excessive scene object counts;
- frequent reprojection/serialization of interactive cells;
- imprecise click selection based on nearest projected screen point instead of real picking;
- decorative fog/effects that add cost without enough product value.

These are useful examples because they reveal a general review theme:

> The architecture is directionally clean, but implementation shortcuts can quietly recreate the complexity the clean architecture was meant to avoid.

---

# 12. Direction map: what is firm, what is a bet, what is just delicious nonsense

## 12.1 Fairly firm

Treat these as current project direction unless the repository or an explicit newer decision contradicts them:

- Arbestra is independent from Waar legacy constraints.
- Server-authoritative simulation/state.
- PostgreSQL is the source of truth.
- TypeScript client/server stack.
- React for HUD/application UI.
- Babylon.js for the game world.
- Real 3D with a 2.5D/isometric reading.
- Fastify backend.
- Rust combat engine as an isolated deterministic simulation component.
- Explicit seeds and reproducible simulation.
- Monorepo.
- HTTP/JSON first; SSE only where useful.
- Avoid Redis/microservices unless actual requirements force them.
- One responsive web client for desktop/tablet/mobile.
- Free-to-play, no ads.
- Do not preserve legacy behaviour for its own sake.

## 12.2 Strong bets, still challengeable

- Single PostgreSQL database with `world_id` partitioning rather than DB-per-world.
- TypeBox-style shared wire contracts.
- Sparse/chunked deterministic terrain.
- Modular low-poly Blender asset kit.
- Toroidal topology as the first world's geometry.
- Oracle as a strong piece of UX/lore glue.
- Cohort-based four-archetype combat with counters/targeting and chained effects.

If there is a strong reason one of these creates disproportionate future pain, say so.

## 12.3 Exploratory / not roadmap promises

- visible donut reveal at extreme zoom;
- internal torus eclipses;
- two intersecting toroidal worlds;
- cube/infinite-scroll worlds;
- variable spacetime/traversal between worlds;
- exotic topology-specific celestial mechanics.

Do not propose six months of generalized engine work to support these.

Do point out small early choices that would unnecessarily kill them.

---

# 13. What we want from Astra

This review is explicitly invited to be critical.

Do **not** merely summarize the repository or praise sensible technology choices.

The useful output is a prioritized assessment of where the current implementation is:

- aligned with the intended architecture;
- accidentally overengineered;
- accidentally under-specified;
- encoding legacy assumptions;
- creating future migration traps;
- doing expensive work in the wrong layer;
- difficult to test or reproduce;
- unsafe around persistence/concurrency;
- likely to fail on mobile/web rendering constraints.

## 13.1 Specific questions to answer

### Architecture

1. Does the current repo actually implement a modular monolith, or only describe one?
2. Are the domain boundaries real or merely folder boundaries?
3. Are transport schemas, domain models and persistence entities adequately separated?
4. Is there any unnecessary infrastructure that should be deleted now?
5. Conversely, are there one or two seams that are cheap now but will be painful later if omitted?

### Server / persistence

6. Are commands idempotent where retries are plausible?
7. Are delayed/realtime actions modeled safely?
8. Can polling or reads mutate state unintentionally?
9. Is world scoping (`world_id`) structurally safe?
10. Are transaction boundaries appropriate for building/occupancy/world-generation actions?
11. Are test/dev/prod database safeguards strong enough that a test suite cannot destroy developer data?

### Client / Babylon

12. Is the React/Babylon boundary clean?
13. What is currently running every frame that does not need to?
14. Which objects should be instances/thin instances/merged/static?
15. Is picking/interaction using Babylon primitives correctly?
16. Is mobile performance being protected by architecture, not just current scene simplicity?
17. Are world coordinates and UI coordinates cleanly separated?

### Spatial model

18. Where are flat-Euclidean assumptions already leaking into code?
19. What is the **smallest** abstraction that would allow toroidal distance/pathfinding later without inventing a general topology framework?
20. Can rendering remain ordinary Cartesian local-space while game movement owns wrapping semantics?

### Rust combat engine

21. Is the Rust engine genuinely framework-independent?
22. Is the API coarse enough for batch execution?
23. Are seeds/versioning/results sufficient for exact reproduction of a combat?
24. Is the engine easy to fuzz/property-test?
25. Is any web/domain concern leaking into the simulation crate?
26. Is the current representation flexible enough for counters, target priorities, wounded units and chained effects without becoming a bag of special cases?

### Testing / calibration

27. Are deterministic tests testing enough invariant/property behaviour rather than just snapshots?
28. Can the soufflerie compare candidate rulesets using identical seeds cleanly?
29. Is simulation filtering done before expensive work, or only at presentation time?
30. Is there a clear path from “engine result” to “why did this ruleset behave like that?”

### Assets / content

31. Does the runtime representation encourage modular asset kits rather than per-level bespoke meshes?
32. Is cosmetic variation decoupled from server-significant state?
33. Is the scene format/pipeline likely to remain maintainable as the asset count grows?

---

# 14. Expected review style

Please classify findings roughly as:

- **Fix now** — cheap today, dangerous if allowed to spread;
- **Next milestone** — important, but not blocking the current slice;
- **Watch** — plausible future issue; do not build for it yet;
- **Do not build yet** — attractive abstraction/infrastructure with no current justification.

For each significant finding, prefer:

1. concrete repo evidence;
2. the consequence;
3. the smallest corrective action;
4. whether the correction preserves or reduces future optionality.

Avoid generic advice such as “add more tests”, “use caching”, “consider microservices”, or “follow SOLID principles” unless tied to a specific place in the code.

If a weird idea such as the torus world appears to justify an abstraction, quantify the smallest useful abstraction.

If it does **not** justify one yet, say so.

---

# 15. Strategic meta-point

The project owner is knowingly investing early and projecting forward into capabilities that are not all needed for the immediate MVP.

That is deliberate.

The goal of this review is **not** to respond with “YAGNI” to every future-facing thought.

Nor is the goal to validate every ambitious idea by building a generalized engine around it.

The useful distinction is:

> **Which early decisions create cheap optionality, and which early decisions are just speculative complexity?**

Examples:

- keeping distance/path semantics behind one module may be cheap optionality;
- implementing arbitrary manifold topology is speculative complexity;
- keeping the Rust simulation independent is cheap optionality and already useful today;
- introducing a distributed event bus for hypothetical scale is speculative complexity;
- separating Babylon scene state from React UI state is useful now and later;
- designing a universal cross-world celestial simulation is not.

In other words:

**Better early than too late — but only for the seams whose cost curves actually justify it.**

That is the lens this audit should use.

---

# 16. One-sentence project brief

**Arbestra is a clean-room, server-authoritative, persistent web strategy game using React + Babylon.js + Fastify + PostgreSQL and a deterministic Rust combat engine, trying to stay brutally simple in infrastructure while leaving just enough room for a world that may eventually reveal itself to be a literal donut with bad routes, cartographers, and eclipses inside its own hole.**
