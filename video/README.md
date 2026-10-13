# Walkthrough script and recording flow

> **Historical pre-release record.** Notes here about the app not being deployed or the video not being recorded describe the state before publication. The current release record is [docs/LIVE_RELEASE.md](../docs/LIVE_RELEASE.md).

The final public-demo video is Ayo Ahmed's delivery after audit and deployment. This folder holds the grounded narration and a deterministic flow that drives the real app, so the walkthrough can be recorded against the deployed URL. **No final video is committed here.** A rehearsal was recorded against a local `wrangler dev` build to check the timing (about 96 s, no gap of 0.6 s or more in the narration). It is not public footage and is not published.

## Grounded narration (14 scenes, about 96 s)
Each line describes something the flow does on screen in that scene, using values from the synthetic fixture and the actual evaluation output.

| Scene | Starts | Narration (caption text) |
|---|---|---|
| s01 |   0.0 s | Forecast Evidence Workbench: an independent concept by Ayo Ahmed. Every record here is synthetic. |
| s02 |   6.3 s | First, a hostile file. Formulas, hidden control characters and a duplicate ID are rejected row by row, so commit stays locked. |
| s03 |  15.0 s | The clean sample previews thirteen opportunities. Each row keeps its exact source reference, and nothing is saved yet. |
| s04 |  21.9 s | Commit is one atomic step. Confirming creates revision one. |
| s05 |  25.7 s | Stage gates check the MEDDIC fields, the economic buyer, pricing approval and the next step. |
| s06 |  31.2 s | Halden Freight is called commit, but its economic buyer was last engaged 53 days ago. So it is not classifiable, and the blocking gap is named. |
| s07 |  40.1 s | Reconcile gives every total with its denominator. Nine of ten open deals convert to pounds. The Swiss franc deal has no imported rate, so it is counted, not converted. |
| s08 |  50.5 s | Weighted on evidence, the forecast is about £83,000 lower than on reported stages. That gap rests on labels, not proof. |
| s09 |  59.0 s | The board narrative is built from the current revision only, with named next actions for each owner. |
| s10 |  64.2 s | Now I record a dated economic buyer meeting for Halden Freight, with its source reference. Saving creates revision two. |
| s11 |  71.0 s | The older narrative is now superseded. It is struck through, and it cannot be marked board-ready. |
| s12 |  76.6 s | The evaluation compares expected and actual values. 31 of 31 pass. |
| s13 |  82.1 s | Switch on one deliberately broken rule, which counts a named buyer as engaged, and three cases turn red. |
| s14 |  88.3 s | No CRM, email or finance system is touched, and no time savings are claimed. Unknown evidence stays unknown. |

Where it matters, the spoken wording differs from the caption so the voice says it clearly ("meddic" for MEDDIC, numbers spelled out). See `says` in [script.json](script.json).

### Grounding for each claim
| Claim spoken | Where it comes from |
|---|---|
| Hostile rows rejected, commit locked | `fixtures/hostile.csv`, test "rejects formula, bidi and control characters" |
| 13 opportunities, exact source references | `IMP-1`, `IMP-2` in `npm run eval` |
| Halden Freight (SYN-1002): EB engaged 53 days before as-of, not classifiable | `CLS-SYN-1002`, the stage-gates card |
| 9 of 10 open deals convert, CHF counted not converted | Reconcile screen, `REC-*` cases |
| Evidence-weighted forecast about £83,000 lower | £387,270.00 − £304,290.00 = £82,980.00 |
| New evidence creates revision 2 and supersedes the narrative | API test "a new revision supersedes older narratives" |
| 31 of 31 pass; the broken rule turns 3 red | `docs/test-output/eval.txt`, `eval-broken.txt` |
| No systems touched, no time savings claimed | Product scope; narrative caveats |

## Deterministic flow
1. `record.mjs` opens a fresh visitor (so revision 0), injects a visible pointer dot that turns yellow on press, and performs every click, keystroke and scroll in fixed order. Each scene runs for the length of its narration plus 0.25 s. Frames are 1280×720 CSS px at DPR 1.5 (1920×1080), each stamped with its capture time.
2. `gen_vo.py` renders one narration WAV per caption phrase using free, local text-to-speech (Piper, `en_GB-alba-medium`).
3. `compose.py` places each WAV at its logged scene time and burns in captions timed to their WAVs. The app sits above a caption band, so captions never cover the UI. There are no zooms.

```bash
mkdir -p video/build && cp video/script.json video/build/
VIDEO_SRC=video/build PIPER_VOICE=/path/en_GB-alba-medium.onnx python3 video/gen_vo.py
BASE=https://<approved-deployment> VIDEO_SRC=video/build CHROME=/path/to/chrome node video/record.mjs
VIDEO_SRC=video/build FONTS_DIR=<dir with Rethink Sans TTF> python3 video/compose.py   # writes video/walkthrough.mp4 + .srt
ffmpeg -i video/walkthrough.mp4 -af silencedetect=noise=-40dB:d=0.6 -f null -   # expect no silence_start
```

Requirements: Node with `playwright-core`, a Chromium binary, Python 3 with `piper-tts`, and ffmpeg with libass. Everything is free and local, with no paid services.

## Caveats
- The flow records whatever the target URL serves. Re-run it after deployment to get public footage.
- The narration is a synthetic voice, not Ayo's.
- If the fixture or rules change, update `script.json` and check the grounding table above.
