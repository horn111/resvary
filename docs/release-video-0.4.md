# Resvary 0.4 Demo Video

Target length: 100 seconds. Hard limit: 120 seconds. Use the website's black, off-white, grey, and restrained glow system. Reuse its typography, line weight, spacing, logo motion, and receipt visual. Do not add a decorative background grid.

## Timeline

| Time    | Scene                                      | Proof                                                  |
| ------- | ------------------------------------------ | ------------------------------------------------------ |
| 0-8s    | Resvary 0.4 title and one-sentence problem | Variable AI cost arrives after execution               |
| 8-22s   | Direct Arc funding request                 | Recipient, Memo ID, calldata, amount                   |
| 22-34s  | Arc Testnet confirmation                   | Arcscan link, receipt, one credit grant                |
| 34-48s  | Gateway Nanopayment request                | x402 requirements, payer, exact amount                 |
| 48-60s  | Circle verify and settle                   | Facilitator reference, settled state                   |
| 60-68s  | Rails converge                             | Two arrows into one credit ledger                      |
| 68-84s  | AI usage lifecycle                         | Reserve, run, commit actual usage, release rest        |
| 84-94s  | Replay                                     | Same Arc tx and Gateway authorization, no second grant |
| 94-100s | Evidence and repository                    | Release tag, tests, demo, evidence page                |

## Remotion requirements

- 1920x1080, 30 fps, 3,000 frames for the 100-second cut.
- Every scene must be frame-deterministic and seek-safe.
- Animate transforms and opacity; avoid layout-driven motion.
- Use real sanitized IDs and screenshots from the evidence manifest.
- Keep any code card on screen long enough to read at normal playback.
- Add captions. Do not rely on narration to explain the funding boundary.
- Render a silent master and a captioned master.
