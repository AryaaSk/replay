# LinkedIn post — Replay launch

Draft saved 2026-04-29. Sequence: hook (analogy) → Zoral context (where this came from) → product → static-encoding insight → Transformer parallel → implications (day-coach + video editing) → close with site + repo links.

---

## Primary draft

You can paste a screenshot into Claude. You can't paste a video. So showing a bug to your AI coding agent is somehow harder than showing it to a colleague.

I'm currently building zoral.ai, an autonomous AI worker. One of the three pillars of any autonomous system is perception, the ability to actually see what's happening on screen, and that's the I/O module I've been working on. Replay came out of that work as a weekend side project, and the underlying idea turned out to be more interesting than the bug-report use case it ships as.

Replay is a Mac app. Hit record, reproduce something, hit stop. About 5 seconds later you have a markdown timeline plus key frames you can paste straight into Claude Code, Cursor, anything.

[demo video + generated markdown side by side]

Source: github.com/AryaaSk/replay. Built on screenpipe, local-only, BYOK.

Here's the underlying observation. LLMs are fundamentally static. They take a fixed-shape input and return a fixed-shape output. Video is dynamic, it has temporal extent, ordering, causality. To pass a screen recording to a model, you have to encode that dynamic stream into a static representation that preserves the temporal information.

This is the same problem the Transformer architecture solved for text. A sentence is a sequence, each word has a temporal position, and you can't evaluate words in random order. Positional encoding kept the temporal information while letting the model see all words at once.

Video has had the same problem. Current video models downsample to N frames and treat each as an independent image, which throws away the temporal structure that made language models work in the first place.

A timestamped markdown timeline with key frames is the video equivalent of token + positional index.

Once a video is addressable, the implications stretch beyond bug reports. Imagine an AI quietly watching your screen all day, telling you at 6pm: "you spent 47 minutes in Slack, 12 of which were re-reading the same thread; your PR for X stalled at 2pm when you got pulled into a meeting." Or AI video editing where you can tweak frame 47 instead of regenerating the whole thing end-to-end from a prompt.

Replay is the bug-report use case. The format is the bigger bet.

→ Site: aryaask.github.io/replay
→ Source: github.com/AryaaSk/replay
→ Day job: zoral.ai

---

## Notes

- First ~150 chars are above LinkedIn's "see more" fold; hook + payoff load there.
- Zoral is woven in as paragraph 2 — establishes credibility (this came from real autonomous-systems work, not LinkedIn-vibes) without front-loading the post.
- The "LLMs are fundamentally static" line is the more general version of the Transformer observation. Doing it in that order — general principle first, then text as the existing instance, then video as the open instance — makes the leap feel inevitable rather than rhetorical.
- Closing line is the thesis. Resist softening it with a CTA question — the sharpness is the point.
- Three links at the close: site (the polished pitch), source (proof / for builders), zoral.ai (the day job, low-key cross-promotion).

## Variants kept for reference

**Shorter** — drop the day-coach + video-editing paragraph, ~1700 chars, lands harder on the static-encoding insight as the only big idea.

**Sharper hook** — replace opening with: "Every AI coding agent on the market can read a screenshot. None of them can watch you reproduce a bug. That's a weird gap." More Twitter-flavoured, slightly contrarian, slightly over-claims.
