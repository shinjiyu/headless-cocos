# T05 — Stop random movement

In `assets/scripts/HeadlessProbe.ts`, keep the square creation, but **disable random movement**.

Requirements:
- Square still appears at start.
- `update` should not move the square toward random targets (empty update or early return is fine).
- Prefer leaving `PROBE_VERSION` / `DEMO_LABEL` alone unless you must touch them.
