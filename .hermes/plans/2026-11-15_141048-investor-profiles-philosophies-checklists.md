# Investment Brain Investor Profiles, Philosophies & Checklists Plan

> **For Hermes:** Planning only in this turn. On approval, execute the structure first, then use non-overlapping subagents for per-investor content and independent review.

**Goal:** Rebuild the Investment Brain's investor pages as rich, corpus-grounded profiles, nest each investor's philosophy beneath them, and add a practical investment checklist for every investor.

**Architecture:** Replace the flat `entities/` + `philosophies/` split with one directory per investor under `investors/`. Each directory holds the profile (`index.md`), philosophy (`<slug>-philosophy.md`), and checklist (`<slug>-checklist.md`). Move books to `references/` and the two operating-company case studies to `companies/`; leave concepts, comparisons, queries, and all raw evidence untouched.

**Primary content source:** The existing 7,450-document Markdown corpus through the DuckDB wiki MCP and, where full context is needed, the underlying files under `~/Development/investment-brain-data/raw/`.

---

## 1. Current-state audit

Audited the live Cabinet room at `~/Development/cabinet/data/investment-brain/`:

| Area | Current state |
|---|---|
| `entities/` | 73 pages: 16 `kind: investor`, 17 `kind: firm`, 40 `kind: reference` |
| `philosophies/` | 26 flat `<slug>-philosophy.md` pages |
| Profiles without philosophies | Benjamin Graham, Charlie Munger, Eddie Lampert, Joel Greenblatt, John Maynard Keynes |
| Non-investor firms | GEICO and See's Candies are business case studies, not investors |
| References | 39 book pages plus `personal-library.md` are mixed into Entities |
| Existing depth | Most profiles are 53–89 lines; philosophies are 47–120 lines; Terry Smith is the deepest at 161 + 120 lines |
| Citation style | YAML `sources:` plus inline `^[raw/...]` provenance markers; this must remain the standard |
| Raw corpus available | 5,568 investor-letter Markdown files, 1,256 Damodaran files, 167 Howard Marks memos, 49 Berkshire letters, 40 partnership letters, 237 textbooks, and other collections |

The corpus is much richer than the current pages' short `sources:` lists suggest. For example, the room currently has no philosophy for Munger despite Wesco/DJCO material and primary Munger speeches/articles, and Graham has primary interviews, lectures, and articles in addition to Buffett's descriptions of him.

### Important Cabinet mechanics discovered

- Wiki links resolve against the **last path segment** (`src/components/editor/editor.tsx:58-82`). A directory at `investors/warren-buffett/` therefore remains a valid target for `[[warren-buffett]]`.
- A directory's `index.md` supplies its title and content. Existing investor links can consequently survive the move to `investors/<slug>/index.md` without rewriting every inbound link.
- Nested files must **not** be named simply `philosophy.md` or `checklist.md`: their slugs would collide across investors. Keep unique filenames such as `warren-buffett-philosophy.md` and `warren-buffett-checklist.md`.
- Do not leave `investors/warren-buffett.md` beside `investors/warren-buffett/`; Cabinet deliberately suppresses a same-named Markdown file when the directory exists (`src/lib/storage/tree-builder.ts:308-312`).
- The cerebro publishing and QA scripts currently assume flat `entities/` and `philosophies/` directories. They must be updated in the same program or the next site sync/quote check will silently miss the new pages.

## 2. Target information architecture

```text
investment-brain/
  index.md                         # refreshed room guide and accurate counts
  investors/
    index.md                       # title: Investors; guide to the three-page pattern
    warren-buffett/
      index.md                     # rich investor profile
      warren-buffett-philosophy.md
      warren-buffett-checklist.md
    howard-marks/
      index.md
      howard-marks-philosophy.md
      howard-marks-checklist.md
    ...                            # 31 investor/firm directories total
  references/
    index.md
    ...                            # 40 existing reference pages, unchanged initially
  companies/
    index.md
    geico.md                       # moved case study, unchanged initially
    sees-candy.md                  # moved case study, unchanged initially
  concepts/                        # unchanged
  comparisons/                     # unchanged
  queries/                         # unchanged
```

`philosophies/` and `entities/` disappear only after every file has been moved with `git mv` and verified. No raw corpus file is edited, moved, or deleted.

### Scope decision embodied in this layout

- **In scope:** all 31 current people/funds/investment firms that belong in an Investors section, including the five missing philosophies and all 31 new checklists.
- **Not in scope:** adding the many additional investors whose raw archives exist but who do not yet have curated entity pages (Nomad, Peter Lynch, Michael Burry, etc.). That is a separate expansion wave.
- **Not in scope:** rewriting book/reference pages, concepts, comparisons, or queries beyond repairing links and counts affected by the move.

## 3. Content contract

### A. Investor profile — `investors/<slug>/index.md`

Keep frontmatter compatible (`type: entity`, existing `kind: investor|firm`, `created`, refreshed `updated`, expanded `sources`, calibrated `confidence`). The profile is the biography and mental-model map, not a duplicate of the philosophy.

Required sections, adapted where the subject is an operator, valuation authority, or macro investor:

1. **Snapshot** — who they are, vehicle/role, active period, and why they matter.
2. **Source base and coverage** — archives used, approximate date span, primary versus secondhand evidence, and important omissions.
3. **Formation and intellectual lineage** — teachers, influences, and career turning points.
4. **Circle of competence and opportunity set** — asset types, sectors, geographies, and situations they actually address.
5. **What they mean by a strong business** — the short source-grounded answer, linked to the full philosophy and checklist.
6. **Valuation and price discipline** — how they think about value, not an invented universal formula.
7. **Portfolio construction and risk posture** — concentration, diversification, leverage, liquidity, time horizon, and hedging where documented.
8. **Management, governance, and capital allocation** — what they demand or reject.
9. **Evolution and dated disagreements** — changes over time; dated market calls remain dated claims.
10. **Failure modes, blind spots, and criticisms** — sourced where possible; clearly labeled synthesis otherwise.
11. **Related pages** — philosophy, checklist, concepts, comparisons, and peer investors.

### B. Philosophy — `investors/<slug>/<slug>-philosophy.md`

Regenerate rather than merely relocate. Preserve the useful existing skeleton but deepen it:

- Core beliefs and first principles.
- What they look for in an investment.
- Definition of a strong company/asset.
- Moat, returns on capital, growth, and reinvestment standards where applicable.
- Management and governance standards.
- Financial/accounting evidence they trust or distrust.
- Valuation method and margin-of-safety requirements.
- Risk definition and controls.
- Portfolio construction, sizing, turnover, and sell discipline.
- Explicit exclusions and behaviors they refuse.
- Evolution by date, including later revisions of earlier doctrine.
- Source limitations and unresolved contradictions.

Use only metrics and thresholds actually supported by a source. When a rule is inferred from repeated behavior rather than stated by the investor, label it as synthesis.

### C. Checklist — `investors/<slug>/<slug>-checklist.md`

This is an operational research worksheet, not another essay. Use Markdown task boxes and concise evidence prompts.

Standard spine:

1. **Mandate and circle of competence**
2. **Business/asset quality — what makes it strong**
3. **Competitive advantage and durability**
4. **Management, incentives, and capital allocation**
5. **Financial and accounting quality**
6. **Valuation and expected return**
7. **Downside, permanent-loss, liquidity, and regime risks**
8. **Security attractiveness versus company quality**
9. **Portfolio suitability — sizing, correlation, concentration, horizon**
10. **Sell/avoid/revisit triggers**
11. **Hard disqualifiers**
12. **Decision record** — evidence gathered, unknowns, disconfirming evidence, and final judgment

Each item should be tagged in a lightweight way:

- **Source** — explicit investor statement or documented rule, with `^[raw/...]`.
- **Synthesis** — inference from multiple sources, labeled as such.
- **Policy** — our operational evidence requirement, not attributed to the investor.

Do not force a Buffett-style moat template onto every subject. Dalio/Druckenmiller need regime, liquidity, asymmetry, positioning, and risk-control questions; Damodaran needs valuation-story/numbers reconciliation; Bezos/Dimon need operator and capital-allocation questions; short/activist investors need thesis, catalyst, governance, borrow/crowding, and downside questions where sourced.

A checklist must distinguish **strong company**, **attractive security at this price**, and **suitable portfolio position**. Those are three separate verdicts.

## 4. Source and citation protocol for every writer

1. Read the existing profile and philosophy as a map, not as authority.
2. Inventory all relevant raw archives before drafting. Search broadly with `wiki_search`; use `wiki_read` or full-file reads for decisive passages and surrounding context.
3. Expand beyond the handful of sources currently listed. Cover early and late material so evolution is not flattened into a timeless doctrine.
4. Prefer the investor's own letters, manuals, speeches, and interviews. Mark class notes, third-party cases, and quotations repeated by another investor as secondhand.
5. Keep every decisive claim revision-bound with the existing `^[raw/...]` convention and list the sources in frontmatter.
6. Quote only verbatim corpus text. Paraphrase OCR-damaged or uncertain passages without quotation marks.
7. Date market opinions and numerical examples. Never present a historical market call as current fact.
8. Set `confidence` from evidence quality, not from the investor's fame. Greenblatt's class notes, Lampert's third-party case, and Keynes-through-Marks require explicit limitations.
9. Do not invent hurdles, position sizes, holding periods, valuation thresholds, or portfolio mandates. Absence of evidence is written as an unknown.
10. Do not use web research to fill gaps in this wave; the ask is a corpus-grounded regeneration. Any needed external expansion is a later, separately approved task.

## 5. Execution sequence

### Phase 0 — Baseline and safety

- Work in the Cabinet data git repository at `~/Development/cabinet/data/`.
- Record the pre-change page list, all `[[wiki-links]]`, and current source counts.
- Keep unrelated dirty state untouched (`.home/`, agent runtime/history, and other room state).
- Make the structural/content commits only when Dom asks for commits; otherwise leave a clean, reviewable diff.

### Phase 1 — Write shared templates and pilot four archetypes

Create the section indexes and the three-page pattern for:

- **Warren Buffett** — deep multi-decade primary archive and doctrine evolution.
- **Terry Smith** — unusually explicit business-quality and valuation rules.
- **Howard Marks** — risk/cycle framework rather than a conventional stock-picking checklist.
- **Stanley Druckenmiller** — macro/asymmetry checklist, proving the template is not forced.

The pilot establishes the final voice, density, citation format, and checklist usability before scaling.

**Pilot acceptance:** each directory has all three pages; direct quotations verify; philosophy and checklist are nested; profile links to both; no fabricated thresholds; Cabinet renders the directory and nested pages.

### Phase 2 — Mechanical structure migration

- Rename `entities/` to `investors/` with `git mv`.
- Convert each of the 31 investor/firm pages to `investors/<slug>/index.md`.
- Move each existing philosophy into its investor directory without changing its slug filename.
- Create empty checklist paths only as part of the immediately following content wave; do not claim stub creation as completion.
- Move the 40 reference pages to `references/` and GEICO/See's to `companies/`.
- Remove the now-empty top-level `philosophies/` directory and its index after all philosophy moves are verified.
- Update `investment-brain/index.md` section names/counts and replace its stale PostgreSQL/raw-mount description with the current DuckDB-indexed corpus workflow.
- Update section order/title frontmatter: Investors remains prominent; References and Companies receive their own indexes.

### Phase 3 — Parallel content waves

One subagent owns one investor directory end to end. Run 6–8 non-overlapping writers at a time; never let two writers share a directory or edit the room index concurrently.

1. **Quality/compounders:** Charlie Munger, Chuck Akre, Tom Russo, Mohnish Pabrai, François Rochon, Chris Bloomstran/Semper Augustus.
2. **Graham/value:** Benjamin Graham, Seth Klarman, Bruce Greenwald, Joel Greenblatt, Tweedy Browne, Bill Miller.
3. **Activists/hedge funds:** Bill Ackman, Dan Loeb, David Einhorn, Julian Robertson, Eddie Lampert, Kerrisdale.
4. **Allocators/operators/other disciplines:** Ray Dalio, Aswath Damodaran, Jamie Dimon, Jeff Bezos/Amazon, Bruce Flatt, Prem Watsa, Markel/Gayner, Berkshire Hathaway, John Maynard Keynes.

Each writer returns: files written, sources actually read, direct-quote count, known evidence gaps, and any doctrine contradictions discovered. The parent verifies those claims against disk and the corpus.

### Phase 4 — Independent review

Use reviewers who did not write the pages:

- **Evidence review:** quotations, citations, dates, source quality, evolution, and unsupported generalizations.
- **Checklist review:** whether each item is actionable, investor-specific, sourced/labeled, and separates company/security/portfolio judgments.
- **Navigation review:** profile ↔ philosophy ↔ checklist links, inbound links from relevant concepts/comparisons, and no orphaned pages.

Fix root causes across all pages when a reviewer finds a repeated pattern.

## 6. Publishing/QA tooling that must change

These are in `~/Development/cerebro/`, not in the Cabinet room:

- `packages/wiki-tools/scripts/check_quotes.py`
  - Change flat `glob("*.md")` scanning to recursive scanning for nested investor directories.
  - Include `investors`, `references`, and `companies`; do not silently omit philosophies now that they are nested.
- `packages/wiki-tools/scripts/build_index.py`
  - Teach discovery/orphan detection the new layout and unique checklist/philosophy slugs.
  - Use `--check-only` for this hand-authored Cabinet room index unless its generator is deliberately redesigned; do not overwrite the room guide with the legacy generic index.
- `apps/docs/scripts/sync_invest.py`
  - Replace `entities` with `investors`, add `references`/`companies`, and discover `investors/*/index.md` plus nested philosophy/checklist files.
  - Preserve stable site links for `[[<slug>]]`, `[[<slug>-philosophy]]`, and new `[[<slug>-checklist]]` links.
  - Replace the old kind-grouped Entities metadata with the new section model.
- `apps/docs/scripts/sync_invest_index.py`
  - Use the same slug map and recursive discovery.
- `apps/docs/scripts/sync_invest_library.py`
  - Read philosophy from `investors/<entity>/<entity>-philosophy.md`.
  - Emit `investment-checklist.mdx` beside `investment-philosophy.mdx`, link it from the investor hub, and place it in navigation.

No site deploy is included without a separate request.

## 7. Verification gates

### Content gate

- 31 investor directories, each with a non-stub profile, philosophy, and checklist: **93 substantive pages**.
- Five previously missing philosophies exist; GEICO and See's are not incorrectly given investor philosophies.
- 40 reference pages and two company case studies remain reachable under their existing slugs.
- Every checklist contains explicit strong-company/security/portfolio sections and hard disqualifiers appropriate to that investor.
- All direct quotes pass verification; expected result is `missing: 0`.

Run after the QA script is updated:

```bash
cd ~/Development/cerebro
CURATED_WIKI_DIR="$HOME/Development/cabinet/data/investment-brain" \
  python3 packages/wiki-tools/scripts/check_quotes.py \
  investors references companies concepts comparisons queries
```

### Link/navigation gate

- Programmatically compare the before/after wiki-link target sets; every pre-existing resolvable investor/philosophy/reference/company link still resolves.
- No duplicate generic `philosophy` or `checklist` slugs.
- No same-named `.md` file suppressed beside an investor directory.
- Every new checklist has at least one inbound link from its profile; every philosophy links back to its profile and checklist.
- Confirm Cabinet's refreshed tree shows Investors with nested investor directories and no legacy Entities/Philosophies sections.

### Publishing gate

```bash
cd ~/Development/cerebro
python3 apps/docs/scripts/sync_invest.py
python3 apps/docs/scripts/sync_invest_index.py
python3 apps/docs/scripts/sync_invest_library.py   # after sync_invest
pnpm --filter docs build
pnpm --filter docs lint:links
```

Expected: synced page counts include the new sections and checklists, no unresolved investor/philosophy/checklist wiki links, MDX builds successfully, and the link linter passes. Report actual counts and output rather than treating script existence as verification.

## 8. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Richer prose introduces fabricated quotations or thresholds | Verbatim quote gate, labeled synthesis/policy items, independent evidence review |
| Nesting breaks Cabinet links | Preserve unique filenames and directory slugs; before/after resolver audit; live tree check |
| cerebro sync silently drops nested pages | Update all three sync scripts and quote/index discovery before running them |
| Repetition across profile/philosophy/checklist | Distinct contracts: context → doctrine → operational worksheet |
| Secondary-only investors look as authoritative as Buffett/Marks | Source-coverage section, calibrated confidence, explicit limitations |
| Large parallel wave produces uneven quality | Four-archetype pilot, one-investor ownership, two independent review passes |
| Room/index or unrelated dirty state gets clobbered | One parent owns shared indexes; writers touch only their assigned directory; never reset unrelated changes |

## 9. Approval checkpoint

The recommended default is the full program above: **31 regenerated profiles + 31 nested philosophies + 31 operational checklists**, with books moved to References and GEICO/See's moved to Companies. Execution should start with the four-investor pilot and the structural migration only after Dom approves the plan.
