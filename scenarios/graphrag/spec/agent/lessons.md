# What earlier attempts learned

Earlier attempts built this system from an empty starter. What they learned while building it is
below, so you don't spend a round finding it again. The starter you get already holds some of it:
extraction by section, the critic switch, the row cap and the split of a looping reply. Each line is
a lesson, not a rule: when your train measurement disagrees, trust the measurement and say so in
your notes.

## Worked

- Graph building by name key, alias key and acronym, with no model, was enough; no model improved on
  it. The starter has the first two. Rule nominations on held-out surfaces made no wrong merges on
  dev; each is taken only with a unique candidate (drop a generic head word like pattern or
  framework; acronym to initials). The misses left were rulings that no rule reaches.
- An entity critic after extraction, as a chat call that keeps, drops or retypes each row against
  the Engagement and Not-a-tool rules, was the one mention change that kept helping
  (`extraction.critic`).
- One type per name key across a document's sections, and dropping names that are a single
  code-style identifier (an agent class, a function), raised mention precision. Without such a rule,
  a prompt edit that resampled every extraction call let in many more code class and function names
  typed tool or system, and dev mention precision fell well past the noise.
- Extracting by section raised mention recall. What it cost in precision came from looping replies,
  code symbols, agent roles and generic words, which dropping looping replies, the critic and the
  identifier rule remove. Without them, section windows lost more precision than they gained recall,
  and a decision-model engagement filter recovered none of it at any threshold.
- Retrieval: for single_hop, rerank anchor edges written as text (ends, label, end types and
  descriptions) over a BM25 shortlist of about 100; a fixed-score shortlist was much worse. List
  non-anchor nodes before anchors for MRR. Reranking two-hop paths and a bridge node's edges raised
  multi-hop. Merging bridge edges by rerank score, not into fixed slots, kept single-hop intact. A
  decision-model check handled unanswerable queries.
- The chat model sometimes returned a document's entities with no relations at all, on every run. A
  follow-up call asking for that document's relations, sent only when the first reply has none,
  fixed it.
- Fold one referent's rows before resolving claims. Strip a parenthetical from a name into aliases.
  Within a type, join rows where one's name key equals another's alias key, or where one is the
  initials of the other. Resolve a claim end the model copied with its parenthetical by the outer
  text, then the inner spellings. Without this, acronym and expansion rows split, and their claims
  scored as false positives. The fix raised dev relation F1, though train barely showed it.

## Failed, more than once

- Relation filters of every kind: an evidence sentence or span per claim, both ends in one sentence
  or within a few sentences, a minimum mention count per end, a cap per source, a decision-model
  verifier, gate or direction check. Each cost more recall than it bought in precision, or did
  nothing; the decision model cannot tell a stated claim from co-occurrence.
- Extra passes that ask for more: "what did you miss", relation gleaning, a relation pass over the
  final entity list or per section unioned with the first, decision-model checks on co-occurring
  pairs. Their claims run far below the first call's precision. Giving section claims calls ends
  from outside the section (the whole document's entities, or its most-named) fanned out onto
  generic classes and the subject. It gained on train and lost on dev.
- Prompts framed around the article's main subject ("what is this article about", "hub first",
  "attach claims to the central entity"). They link the subject to everything near it.
- Direction rules and inverse-label maps in the prompt. Reversed claims went up, not down, or a
  train gain vanished on dev. An inverse-label map in code never fires when the prompt fixes the
  label vocabulary. Reversed claims are a small error group either way.
- The decision model as an entity filter. It ranks core methods below junk, drops named tools,
  models and organizations an article compares or uses briefly, and passes code symbols. Exempting
  person, organization, model and tool rows and filtering only method and system rows raised dev
  mention recall, but let in organizations and CLI programs named in passing.
- A count or frequency floor, or a count target or cap per document ("20-30 entities"). It fits
  train's sparse gold and under-extracts everywhere else.
- A document character cap. What it cuts is never extracted.
- One type per name across the corpus. Within one document, one type per key is right.
- A second or swapped few-shot document, gold relations shown as text, voting over seeds, sampling
  above temperature 0. Reasoning on also failed: on the whole call it gave a small mention gain and
  a larger relation loss. On the entities call alone it cut train mention recall sharply and ran
  several times slower.
- Rescuing known entities the article names but the entities call skipped failed in every form
  tried. These forms were: proposing every known key in the body through an engagement filter; one
  chat engagement check per document, with evidence sentences; and listing the skipped names in the
  claims call as not yet extracted. Each added few rows, mostly not gold, and none moved dev mention
  recall or relation F1.
- Limiting what the critic may drop lost precision both ways it was tried. Never dropping method or
  system rows (dropping only list-only tools, organizations, people and models) let in many false
  positives. Never dropping known-entity rows did the same and also lowered relation F1. Narrowing
  the critic instead (retype to system only for lowercase names, drop agent roles in the article's
  own pipeline) moved nothing beyond noise.

## The lever for relations

- Most missed relations lack an end, most often a method or system; on dev many were known entities
  the section names but the entities call skipped. Direction and labels are small next to that.
  Raise relation F1 through mention recall for those types and by cutting fan-out, not by filtering
  claims. Fan-out is the subject joined to entities named near it but never related to it. Claims
  the article states about its subject are gold.
- Dev errors showed narrower or qualified variants written as aliases of a broader known entity.
  Examples were a single- or multi-agent variant of the agent class, an agentic or bottom-up variant
  of a method, and a model family member on the base model. The article's core class then goes
  missing, and its claims land on the broad class as false positives. The canon rule to write the
  known name invites this. No fix has been tested yet.

## Traps train doesn't show

- A reply cut at the token limit is a loop, not a long answer. Salvaging its rows wrote hundreds of
  junk rows for one document and decided whole rounds (`runtime.md`, Typed replies).
- Held-out documents get every earlier document's entities as `known_entities`, and they can be
  longer than any train article. Matching known names by substring flooded the prompt with short
  names that occur everywhere; the starter matches whole key tokens. The stress run in `train.md`
  (Scoring your work on train) catches both.
- A drop in train mention precision carried over every time; a train gain in relation F1 rarely did.
  Train relation F1 swings several points between seeds of the same code, so one run's gain there is
  noise (`train.md`, Scoring your work on train).
- A retrieval metric scored on few queries can pass on one split and fail on the next. Keep a change
  that raises it on train even when the feedback says it already passes.
- Background jobs died without a word and cost whole rounds of waiting (`runtime.md`, Running it).
  Another round was lost because the commit carried none of the changes measured on train, so dev
  tested nothing. Check that `git diff` against the kept commit holds every change, switched on.
- The critic call lists all of a document's rows, so any change to its mention list resamples the
  critic. Its noise then shows on both metrics in every document the change touched, which hides
  small effects. One resampled critic call on the stress input dropped more than half its rows. A
  cap on the share of rows the critic may drop never fired on dev and changed nothing.

## Failed once, not yet confirmed

- Prompt lines asking the single extraction call for more (be exhaustive about principles, failure
  modes and model versions; keep named things met in comparisons) lowered precision more than they
  raised recall on train.
- Changing the entities call's window or examples did not raise recall. One train section with its
  gold rows as a few-shot example in the entities prompt was flat on train. Entities calls on
  smaller windows inside each section lowered train recall, and a union with the whole-section call
  gained nothing. Train mention recall stayed level whatever the window.
- Letting the claims call name ends outside the section's entity list, with types, so they become
  new mentions: the model wrote no such end on train. Free-form out-of-list ends don't fire.
