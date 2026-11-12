# What five graphrag-lite nights taught, and what to change

Status: applied 2026-11-09 to graphrag and graphrag-lite: lessons.md (3.1), spec edits (3.2), starter
fixes (3.3) and the held-out values in the spec (3.5). Not applied: the loop changes (3.4). One
deviation: the canon matches whole key tokens with no minimum length, since a floor would drop
two-letter names a section does name ("AI", "uv").

No dev or test item is named here. Dev and test numbers are aggregates.

## 1. The outcome

| night | rounds | kept | dev mention F1 | test mention F1 (P / R) | test relation F1 | test multi_hop |
|---|---|---|---|---|---|---|
| 133126 | 3 | r1 | 0.699 | 0.716 (0.74 / 0.69) | 0.316 | 0.13 |
| 143642 | 4 | r4 | 0.712 | 0.625 (0.51 / 0.80) | 0.264 | 0.18 |
| 164949 | 4 | r1 | 0.716 | 0.686 (0.77 / 0.62) | 0.326 | 0.18 |
| 183056 | 8 | r3 | 0.718 | 0.545 (0.40 / 0.84) | 0.215 | 0.27 |
| 022926 | 6 | r3 | 0.656 | 0.723 (0.76 / 0.69) | 0.292 | 0.18 |

Thresholds: mention F1 0.9, relation F1 0.4, multi_hop path_complete 0.3.

- **No night beat the first round of the first night on test.** 25 rounds and about $43 of coder,
  reviewer and model spend left mention F1 at about 0.72 and relation F1 at about 0.32.
- **The more recall a kept commit bought, the worse it did on test.** The two kept commits that pushed
  recall hardest scored the worst test F1, at test precision 0.40 to 0.51. The most conservative one
  scored the best test result from the lowest dev score.
- **Multi_hop failed on test in all five nights**, while dev showed it at or above 0.3. Dev has 10
  multi_hop queries, so one query is 0.1 of the metric.
- **Graph was solved in round 1 every night.** Name key, alias key and acronym merges with no model
  reached B-cubed P 1.0 and R 0.99 on dev and test. Nothing later touched it, correctly.

## 2. Why, ranked by how many points each cost

### 2.1 Runaway replies, salvaged into the output (4 of 5 nights)

**Problem.** A whole-document extraction call sometimes loops: it repeats rows until it hits
`max_tokens`. The code then salvaged every complete row before the cut and kept them.

**Trace.** In one round, one long dev document produced 101 entities and 351 relations, which made 305
of that round's 914 false-positive relations. In another, one section reply was salvaged into 617
entities on test. Without its one runaway document, a reverted round would have scored mention F1 0.742
against the kept 0.698. The reviewer never saw the `finish_reason=length` warnings (2.6), so it
diagnosed "generic noun phrases" and proposed filters for a cause that was one truncated reply.

**What the new starter does.** It extracts by 6000-character section, which bounds each reply. It
still salvages a truncated reply row by row (`contracts.py`, `salvage_rows`; runtime.md says the same).
That is the exact defect. **Fix:** a reply cut by length is degenerate. Drop it, split the section in
two and ask again, once, and cap rows per reply in code (3.3).

### 2.2 Train never exercises the held-out failure modes (all nights)

**Problem.** Train looks harmless where held-out documents break the program.

- **Length.** Train articles are 22k to 38k characters. Test holds a 51k one, the longest in lite. A
  whole-document call on it runs out of output tokens.
- **Known entities.** A train document's `known_entities` is small, because train comes first. Held-out
  documents get every earlier document's entities: hundreds per test document. One night's code
  substring-matched every known name of two or more characters into the prompt. Short names such as
  package managers and CLI acronyms match nearly any text, and the model was told to reuse them.
- **Density.** Train gold is sparse: 0.73 mentions per 1000 characters against 1.7 on dev and 1.9 on
  test. The lite spec says train articles are "the shortest"; they are in fact the longest. Only their
  gold is sparser.

Code-heaviness is not the discriminator: train has the most code fences of the three parts (up to 23
per article).

**What the new starter does.** It uses section extraction, so length is bounded. But `canon()` in
`extract.py` still substring-matches with no word boundary or minimum length. It also pads each type
with known entities the section never names, up to 40 per type, which invites the model to emit them.

### 2.3 Relation work aimed at the wrong lever (every night after round 1)

**Problem.** Relation F1 has the largest weighted shortfall: 0.25 of 0.4 is a share of 0.63, against
0.70 for mentions. So both the reviewer's "largest shortfall first" rule and the coder send-back
("try a clearly different way to raise relations") always named relations. About 20 relation-only
attempts in the last night alone all failed.

**Trace.** On dev, 39 to 77% of missed relations had an end that extraction never produced, more than
half in 18 of 25 rounds. On dev, relation F1 with direction ignored stayed below 0.4 (0.34 at
best), so orientation alone cannot reach the threshold. About half of false-positive relations join
two gold entities with a claim the gold doesn't hold: hub fan-out.

**Conclusion.** Relation F1 moves through mention recall and fan-out, not through relation filters or
direction prompts.

### 2.4 Keep decisions driven by noise and by failures read as noise (all nights)

- **An empty document was measured as noise.** In 183056, round 1's first dev run had one document
  return empty (mention F1 0.595). Its replay-free re-run had none (0.716). The loop recorded the
  0.058 gap as the evaluation's noise and kept the depressed first score as the checkpoint. Round 3
  was then kept against it at +0.058, though against the re-score it gained nothing (0.9323 against
  0.9327). Train had shown round 3's precision falling from 0.68 to 0.43, and test followed (0.40).
- **The checkpoint is its first draw.** In 164949 the kept round drew 0.934 and then 0.956. Rounds 2
  to 4 all beat 0.934, but none beat 0.956, and all were reverted.
- **One multi_hop query outweighs the margin.** One query flipping moves the score by
  0.1 / 0.3 / 6 = 0.056. That is 11 times the 0.005 margin cap. The last night's A/A gap of 0.069 was
  almost all one multi_hop query, measured on a stage the experiments never changed.
- **Unpaired train runs swing about 0.045 mention F1 and 0.04 to 0.10 relation F1.** The spec says to
  read a gain under 0.02 as none. Coders who measured noise (three of five nights) kept single-run
  gains inside it anyway. The paired comparisons that worked rescored cached model output offline, or
  reran under replay so only the changed calls were fresh.

### 2.5 Metrics past threshold frozen on too few queries (all nights)

The coder prompt's `<met>` block tells the coder to plan no task for a metric the checkpoint reaches on
dev. Retrieval reached multi_hop 0.3 to 0.5 on dev in round 1 and was left alone. Bridge expansion with
the anchor's top edges protected lifted train multi_hop from 0.29 to 0.71 and dev from 0.30 to 0.50.
It was reverted twice, because a capped metric adds nothing to the score. Test multi_hop then landed
at 0.13 to 0.27. No night built a date filter for temporal queries, and abstention scored 0 in two.

### 2.6 Process failures

- **Short rounds, no clock.** Coders stopped at 4 to 12 of their 25 minutes in every round. They were
  sent back one or two times, which cost $1.63 of one night's $4.41 coder spend. They misjudged
  elapsed time ("13 already gone" at minute 3). Nights ended after about 75 minutes of a 6-hour
  deadline, on max_rounds or plateau.
- **Rejected diffs don't apply.** `saveRejected` writes `/spec/history/rN.diff` with the trailing
  newline stripped. `git apply` fails with "corrupt patch", and coders retyped earlier work by hand,
  differently. Confirmed on every saved diff.
- **The reviewer is blind to the program's stderr.** `evaluate.ts` saves each stage's `run.log`, but
  only a failed evaluation passes it on. Every `finish_reason=length` warning and every per-document
  collapse was invisible to the reviewer and to the next coder.
- **The reviewer re-proposes rejected ideas.** Examples: a decision-model claim filter after banning
  claim filters, direction as a lead task after "don't spend a round on direction", and a second
  few-shot document and reasoning-on after a coder measured both worse.
- **Background jobs died silently.** About 21 minutes in one night went to polling `nohup` jobs that
  had exited.
- **One idea per round.** Several measured gains of about +0.015 each (verify-prompt exclusions,
  known-entity recall, section extraction) each sat under the margin and were never stacked.

## 3. Proposed changes

### 3.1 New spec file: `spec/agent/lessons.md` (the "memory")

`readSpecText` sends every `spec/*.md` to the coder and the reviewer, so a new file reaches both with no
code change. **It carries no number, count, ratio or comparison taken from dev or test**, and no item.
A value from dev tells the coder something about the dev documents and leaks them, however
aggregated. It holds generic lessons on what worked and what didn't while building the system,
stated so the coder can check each one on train. Draft:

```markdown
# What earlier attempts learned

Earlier attempts built this system from an empty starter. What they learned while building it is
below, so you don't spend a round finding it again. Each line is a lesson, not a rule: when your
train measurement disagrees, trust the measurement and say so in your notes.

## Worked
- Graph building by key, alias key and acronym, with no model, already passes. Leave it alone.
- An entity critic after extraction, as a chat call that keeps, drops or retypes each row against
  the Engagement and Not-a-tool rules, was the one mention change that kept helping.
- One type per name key across a document's sections, and dropping names that are a single
  code-style identifier (an agent class, a function), raised mention precision.
- Extracting by section raised mention recall. What it cost in precision came from runaway
  replies and code symbols, which the critic, the identifier rule and the length rule below remove.
- Retrieval: reranking two-hop path candidates, and expanding through a bridge node while keeping
  the anchor's best edges, raised multi-hop. A decision-model check handled unanswerable queries.
- Comparing two versions paired: rerun under replay so only the calls a change reached are fresh,
  or save the raw replies once and rescore every filter variant offline.

## Failed, more than once
- Relation filters of every kind: an evidence sentence or span per claim, both ends in one
  sentence, a minimum mention count per end, a cap per source, a decision-model verifier or gate.
  Each cost more recall than it bought in precision.
- Extra passes that ask for more: "what did you miss", relation gleaning, a separate relation pass
  over the final entity list, a relation pass per section. Most of what they added was wrong.
- Prompts that centre claims on the article's main subject ("hub first", "attach claims to the
  central entity"). They link the subject to everything near it.
- Direction rules and inverse-label maps in the prompt. Reversed claims went up, not down.
- The decision model as an entity filter. It ranks core methods and systems below junk.
- A count target or cap in the prompt ("20-30 entities"). It fits train's sparse gold and
  under-extracts everywhere else.
- A second few-shot document, reasoning on, voting over seeds, sampling above temperature 0.

## The lever for relations
Most missed relations lack an end: extraction never produced one of the two entities, most often a
method or a system. Fixing direction or labels is small next to that. Raise relation F1 through
mention recall for those types and by cutting fan-out, not by filtering claims.

## Traps train doesn't show
- A reply cut at the token limit is a loop, not a long answer. Salvaging its rows wrote hundreds of
  junk rows for one document and decided whole rounds. Drop it and split the input.
- Held-out documents get every earlier document's entities as `known_entities`, and they can be
  longer than any train article. Matching known names by substring floods the prompt with short
  names that occur everywhere. Before you stop, run extraction on two train articles joined into
  one input, with every train gold entity as its `known_entities`, and compare its rows per 1000
  characters with the single articles'.
- A drop in train mention precision carried over every time; a train gain in relation F1 rarely
  did. Read precision, recall and row counts, never F1 alone.
- A retrieval metric scored on few queries can pass on one split and fail on the next. Keep a
  change that raises it on train even when the feedback says it already passes.
- Background jobs died without a word and cost whole rounds of waiting. Run the program in the
  foreground under `timeout`, with its output in a file.
```

### 3.2 Edits to the existing spec files

The same rule applies: train numbers only.

- **`train.md`, "Train is also the sparse end".** Replace the sentence with "Train's documents are the
  earliest, and their gold is the sparsest: about 0.7 mentions per 1000 characters. Held-out gold is
  denser." Drop "shortest", which is wrong, and drop the held-out multiple (3.5).
- **`train.md`, noise paragraph.** Replace "read an F1 gain under about 0.02 as none" with train's own
  measurement: an unpaired rerun on train moved mention F1 by up to about 0.045 and relation F1 by up
  to about 0.1. Compare paired, as lessons.md says. A mention change that lowers train precision by
  more than 0.05 is a regression whatever it does to recall.
- **`train.md`, new "Before you stop" bullet.** The stress run from lessons.md: two train articles
  joined, all train gold as known entities, rows per 1000 characters compared.
- **`task.md`, Extraction.** Add one sentence pointing relation work at mention recall (lessons.md,
  "The lever for relations"). Add that the program logs, per document on stderr, its row counts and
  every cut reply, because the reviewer reads the evaluation's stderr (needs loop change 3.4.4).
- **`runtime.md`, Models.** Replace the salvage sentence: a reply with `finish_reason: "length"` is
  dropped, its section split in two and asked again once, and the split is logged. Add: run the
  program in the foreground under `timeout`, and check the clock with `date`.

### 3.3 Starter fixes (graphrag and graphrag-lite)

1. **Length means split, not salvage.** `llm.chat_json` returns the finish reason. When it is
   `length`, `extract_section` splits the section at its middle paragraph boundary and extracts both
   halves, one level deep. `salvage_rows` stays only for a complete reply with broken JSON.
2. **Row cap per reply in code.** `[extraction] max_rows_per_reply` (default 60): a reply over it is
   treated as degenerate, the same as a length cut. That is several times the densest held-out
   section, so it never cuts a real reply.
3. **Canon matches names, not substrings.** Match a known entity when the key of its name or of an
   alias appears in the section's key tokens (`graph/keys.py`), with a minimum key length of 3. List
   only entities the section names, and drop the padding with unnamed ones. Keep `canon_per_type` as
   the cap.
4. **Per-document stderr line.** One line per document: sections, cut replies, mentions and
   relations kept, rejected by reason. This is what the reviewer would read (3.4).
5. **Leave `critic = false` as the default**, but name it in config.toml's comment as the first knob
   to measure. Earlier nights measured it as the one repeated mention gain.

### 3.4 Loop changes (codeclimb's own code; none are spec)

Ordered by points at stake:

1. **Diffs end with a newline.** In `saveRejected`, write `diff.endsWith("\n") ? diff : diff + "\n"`.
   One line, so `git apply` works.
2. **An A/A pair is noise only when both runs are whole.** If `extraction.documents.empty`, a stage's
   row count or its failed-call count differs between the two runs, the gap is a failure, not noise.
   Re-run the pair (it already retries once), and don't set the margin from it. The checkpoint's
   score is the mean of its runs, not its first draw.
3. **Noise per stage.** Record the A/A move per stage, and scale each stage's part of the margin by
   that stage's own fresh-call share. An experiment that left retrieval replayed inherits none of
   retrieval's noise. Today, one multi_hop flip in the A/A sets a margin the extraction change is
   judged against.
4. **The reviewer reads stderr.** Pass each stage's `run.log`, masked by the scan and cut to its
   warning lines, into the review prompt beside the per-item errors.
5. **Headroom before "met".** List a metric under `<met>` only when the checkpoint clears its threshold
   by its ci95 half-width, where one exists. Otherwise list it as "met on dev, fragile". Multi_hop at
   0.3 to 0.5 on 10 queries is fragile.
6. **Send-back names the lever, not the shortfall.** When the reviewer's hypothesis exists, the
   send-back points back at its untested parts instead of "the metric furthest below". Without one,
   it asks the coder to read the worst train items, the current second branch.
7. **A clock.** Put the round's end time in the prompt as a sandbox `date` value. Coders said "13
   minutes gone" at minute 3.
8. **A ledger of failed families.** Give the reviewer the coder task lists' "dropped" notes from every
   earlier round, as one list, with the instruction that a hypothesis may not repeat a family on it
   without saying why train misled. The long-run version of this ledger is lessons.md, kept by the
   operator across nights.
9. **Night length.** Nights stop at max_rounds in about 75 of 360 minutes. Raise `max_rounds`, or let
   a reverted round that beat the checkpoint's score (but not the margin) earn a combination round:
   the next hypothesis stacks it with the earlier near-misses.

### 3.5 Dev and test values already in the spec

The current specs quote held-out aggregates. The coder can't measure any of these, so each tells it
something about dev or test. The first group I added in the 2026-11-09 update; the second was there
before it.

| file | line | quotes | generic replacement |
|---|---|---|---|
| both `task.md` | Density bullet | held-out "two to three times denser", "the densest reach about 70 mentions and over 90 claims" | "held-out documents are denser than train's, because their gold names more of what each article engages with" |
| both `train.md` | sparse-end bullet | "held-out medians run two to three times that" | the 3.2 sentence |
| `graphrag/train.md` | small-end bullet | "up to about 800 known entities" | "every earlier document's entities, many more than train's" |
| `graphrag/runtime.md` | Evaluation bullet | "on dev it is several times longer than train's longest" | "on a held-out document it is longer than train's longest" |
| `graphrag/train.md` | parts table | "the next 25 (dates): 90 retrieval queries" for dev | keep the date range or drop it; drop the query count |
| `graphrag/train.md` | few-shot | coined rows: "dev 6 and test 4" | "train has none; held-out parts have some" |
| `graphrag/train.md` | Few merges | "Dev holds 23 merge decisions, so one decision moves merge recall by about 4 points" | "held-out parts hold few merge decisions: read raw counts beside the rate" |
| `graphrag/train.md` | retrieval mix | "three-hop paths included" | keep: `task.md` already allows 3 hops, so it states the contract, not data |

The lite spec has only the first two rows. Its train counts (144 mentions, 180 relations, 29 queries)
are train, and stay.

## 4. Decisions for you

1. **Lite only, or graphrag too?** None of these nights ran on the full dataset. The starter fixes
   (3.3), the loop fixes (3.4) and the spec cleanup (3.5) apply to both. lessons.md is generic, so it
   could ship to both as it is.
2. **Loop changes 3.4.2 and 3.4.3 change keep decisions.** They need tests in `core.test.ts`, and
   decisions in a new night would not be comparable with these five.
3. **The operator keeps lessons.md.** After each night, someone has to move what that night learned
   into it, in the same generic form. Loop change 3.4.8 covers one night; across nights it is
   manual.
