# T09 — Add CTA label via script

In `assets/scripts/HeadlessProbe.ts`, when the component starts, also create a child UI label node named `CtaLabel` under the same parent as the square.

Requirements:
- Node name exactly `CtaLabel`
- Add `UITransform` + `Label` (from `cc`)
- Label string exactly `TAP TO PLAY`
- Font size `28`
- Position roughly `(0, -120, 0)` (below center)

Keep the existing square behavior unless it conflicts.
