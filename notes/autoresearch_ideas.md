# Ideas from autoresearch, applied to coding

Source: https://github.com/karpathy/autoresearch

autoresearch lets an agent change `train.py`, train for 5 minutes, read one number (`val_bpb`), then keep or discard the commit, and repeat overnight. It tunes an ML model, but the loop isn't specific to ML. Applied to coding:

| autoresearch | Coding (codeclimb) |
|---|---|
| `train.py`, the file the agent edits | The program in `/repo` |
| `prepare.py`, the frozen evaluation | The scenario's scorers, on the host, with gold out of reach |
| `val_bpb`, one metric | Headline metrics on dev, with margins |
| Training for a fixed 5 minutes | Running the program on dev, with model calls |
| `git reset` on a worse result | Reverting to the checkpoint |
| `program.md`, edited by the human | The spec and the reviewer's protocol |

The main difference: training is measured directly, while a coding task's score depends on noisy model calls and on hidden data the coder must never see. Most of the changes below follow from that.

## 1. Reduce evaluation noise

**autoresearch:** `train.py` fixes its seed, and the validation shard is pinned, so a score change comes from the code.

**For coding:** a program that calls a model is not deterministic. In the graphrag smoke night, identical code moved mentions F1 from 0.6717 to 0.6576, close to the 0.02 margin. A per-night cache of the program's model calls during evaluation would return the same answer for the same request. Unchanged code would score the same, and only what a change touches would move. Repeat calls would also cost nothing.

**Status:** implemented, in the metering proxy: within a night, a later evaluation gets an earlier evaluation's answer to an identical request, free and with the same delay. A second identical request in one evaluation still goes upstream, so a program can retry a bad answer.

## 2. Reward simplification

**autoresearch:** `program.md` says all else being equal, simpler is better. An improvement of about 0 from much simpler code is kept, and a tiny gain that adds ugly code isn't.

**For coding:** an agent that is only paid for metrics adds code every round. Unused code still costs: it is more to read, more to pay for in tokens and more to break. A change that deletes code and stays within the margins should count as a gain.

**Status:** implemented, as a rule for the reviewer and the coder.

## 3. Keep output out of the agent's context

**autoresearch:** the agent redirects each run to `run.log` and reads it with `grep`, because a run's output would flood its context.

**For coding:** the coder pays for everything its shell prints, in every later turn. A full run over the train data can print far more than the coder needs. Writing it to a file and reading the part that matters costs a fraction of that. In the first full graphrag night, tool output was only 25-29k characters per coder, so most of a coder's tokens were context re-sent each turn, not run output.

**Status:** implemented, as a line in the coder's prompt.

## 4. Combine near-misses when stuck

**autoresearch:** when out of ideas, the agent should re-read the code for new angles, try "combining previous near-misses", or try more radical changes.

**For coding:** a rejected change often helped one metric and hurt another. Refining the same path after repeated reverts tends to fail the same way. Rejected diffs under `/spec/history` make it possible to take the part that worked and leave the rest.

**Status:** implemented, as a rule for the reviewer's hypothesis.

## 6. Fix small crashes instead of losing the round

**autoresearch:** when a run crashes, the agent reads the traceback. If it's something dumb and easy to fix, it fixes it and re-runs. It logs `crash` only if the idea itself is broken.

**For coding:** a typo says nothing about the idea, yet a failed evaluation used to cost the whole round: the code was dropped and the hypothesis stayed untested. Each round now gets one repair attempt: a coder starts from the failed commit, reads the masked errors, and its fix goes through evaluation and review as usual.

**Status:** implemented.

## 7. Fail fast

**autoresearch:** `train.py` stops at once on a NaN or exploding loss, so a broken run doesn't use the rest of its 5 minutes.

**For coding:** evaluation already stops at a stage that crashes. A stage that exits cleanly with no output is the same kind of failure: the program swallowed its errors. It can't be kept, yet the later stages still ran and spent money on model calls. On dev, evaluation now stops there and reports the end of the stage's log. Test runs every stage, because its scores are only ever reported.

**Status:** implemented.
