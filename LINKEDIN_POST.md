# LinkedIn post — Replay launch

Draft saved 2026-04-29. Sequence: hook (analogy) → product → day-coach (accessible example) → Transformer positional-encoding insight → video-editing implication → close.

---

## Primary draft

You can paste a screenshot into Claude. You can't paste a video. So showing a bug to your AI coding agent is somehow harder than showing it to a colleague.

I spent last week on Replay: a Mac app that closes that gap. Hit record, reproduce the bug, hit stop. About 5 seconds later you have a markdown timeline plus key frames you can paste straight into Claude Code, Cursor, anything.

[demo video + generated markdown side by side]

Source: github.com/AryaaSk/replay. Built on screenpipe, local-only, BYOK.

The more interesting thing is what the format unlocks.

Imagine an AI quietly watching your screen all day. At 6pm it tells you: "you spent 47 minutes in Slack, 12 of which were re-reading the same thread; your PR for X stalled at 2pm when you got pulled into a meeting." That feedback loop has been technically possible for a while. What it actually needed was a structured representation of what you did. Replay produces exactly that.

This is the same breakthrough the Transformer architecture made for text. A sentence is a sequence, each word has a temporal position, and you can't evaluate words in random order. Positional encoding kept the temporal information while letting the model see all words at once.

Video has had the same problem. Current video models downsample to N frames and treat each as an independent image, which throws away the temporal structure that made language models work in the first place.

A timestamped markdown timeline with key frames is the video equivalent of token + positional index.

Once a video is addressable, the next thing it unlocks is fine-grained editing. Today AI video tools generate end to end from a prompt and you can't tweak frame 47. With a structured intermediate you edit at the script level: cut t=3 to t=5, replace dialogue with X. The same diff-and-PR workflow we have for code.

Replay is the bug-report use case. The format is the bigger bet.

---

## Notes

- First ~150 chars are above LinkedIn's "see more" fold; hook + payoff load there.
- "Last week" is loose, swap for whatever feels right.
- Closing line is the thesis. Resist softening it with a CTA question — the sharpness is the point.

## Variants kept for reference

**Shorter** — drop the day-coach paragraph, ~1100 chars, lands harder on the Transformer insight as the only big idea.

**Sharper hook** — replace opening with: "Every AI coding agent on the market can read a screenshot. None of them can watch you reproduce a bug. That's a weird gap." More Twitter-flavoured, slightly more contrarian, slightly over-claims.
