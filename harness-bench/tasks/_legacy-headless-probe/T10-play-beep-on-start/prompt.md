# T10 — Play beep on start

There is an audio file at `assets/audio/beep.wav` (with `.meta`).

Update `assets/scripts/HeadlessProbe.ts` so that on `start` it loads/plays this clip once (AudioSource or `audioEngine` / `AudioClip` pattern acceptable for Creator 3.8).

Requirements:
- Reference the project beep asset (import from relative path or load by path/uuid if you document it in code comments).
- Prefer adding an `AudioSource` on the same node or a child and calling `play()` after assigning the clip.
- Do not delete existing square logic.

If you import the wav as a module, keep the `.meta` uuid intact (do not recreate meta).
