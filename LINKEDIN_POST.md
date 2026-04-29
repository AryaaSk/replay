# LinkedIn post — Replay launch

Final draft 2026-04-29. Two links: GitHub repo + zoral.ai. Demo video uploaded natively to the post.

---

## Post body

AI coding agents can see your screenshots. They can't watch you reproduce a bug.

That's the gap I spent last week closing.

Replay is a Mac app. Hit record, reproduce the bug, hit stop. Five seconds later you have a structured markdown timeline plus key frames, ready to paste into Claude Code, Cursor, or anywhere else. The demo below shows the loop end to end.

The bug-report use case isn't really why I built it.

I'm working on perception at zoral.ai, an autonomous AI worker that observes you for a week and replaces you on day eight. Perception is one of the three pillars of any autonomous system: an agent has to see what's happening before it can decide or act. Replay started as a side experiment in that work, and the result turned out to be more interesting than the product it ships as.

LLMs are fundamentally static. They take a fixed-shape input and return a fixed-shape output. Video is dynamic, with temporal extent and ordering and causality. To pass a screen recording to a model at all, you have to encode that dynamic stream into a static representation that preserves the temporal information.

This is the same problem the Transformer architecture solved for text.

A sentence is a sequence; each word has a temporal position; you cannot evaluate words in random order. Positional encoding kept the temporal information while letting the model see all words at once.

Video has had the same problem, mostly unsolved. Current video models downsample to N frames and treat each as an independent image, which throws away the structure that made language models work in the first place.

A timestamped markdown timeline with key frames is the video equivalent of token plus positional index.

Once a video is addressable, the implications stretch well past bug reports:

- An AI quietly watching your screen all day, telling you at 6pm what you actually did with it.
- Diffable video editing, where you tweak frame 47 instead of regenerating end to end.
- Product demos that survive being shared, with fine-grained context any engineer can grep through weeks later.

Replay is the bug-report use case.

The format is the bigger bet.

→ github.com/AryaaSk/replay
→ zoral.ai

---

## Notes for upload

- Hook lives in lines 1-2 (above the "see more" fold): "AI coding agents can see your screenshots. They can't watch you reproduce a bug." Then the one-line paragraph "That's the gap I spent last week closing." closes the cliffhanger right under the cut.
- Variation in pacing: short hook, one-line pivots, dense technical paragraphs, semicolon-triple list, bulleted implications, two-line close. Reader's eye keeps moving.
- Demo gets uploaded natively to LinkedIn (don't link to YouTube; the algorithm penalises external video). Body says "demo below shows the loop end to end."
- The Zoral framing is paragraph 5. Don't trim it; it reframes Replay from "weekend hack" to "fragment of real autonomous-systems work."
- Closing two lines are single-sentence beats. Hard cut. Don't add a CTA question after.
