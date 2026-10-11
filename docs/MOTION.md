# Motion and interaction (Oct 2026)

The homepage hero, buttons, cards, panels and header use CSS and one small script. **No animation library is installed.**

## Where things live

| Part | Where |
| --- | --- |
| Hero stage | `src/components/HeroStage.tsx` and the `stage__*` classes in `globals.css`. It shows the piece in `src/data/hero.ts`. |
| Piece entrance | CSS keyframes `stage-drop` and `stage-shadow`. |
| Window entrance | CSS keyframe `stage-open`. |
| Headline entrance | CSS keyframe `line-up`, timed with the piece. |
| Pointer depth (desktop) | `HeroStage`: a spring writes `--px`/`--py`. The piece and its shadow shift a few pixels together and the light pool shifts the other way. The piece is never rotated in 3D or scaled. The loop stops when the stage is at rest, off screen or hidden. |
| Section reveals | `RevealObserver` in `Chrome.tsx` (`data-reveal`). |
| Pausing loops off screen | `RevealObserver` also sets `data-offscreen` on sections that are off screen. While set, the button glint pauses. |
| Panels | `Dialog.tsx` plays an exit (`data-closing`) before closing. Menu entries are staggered. Directions follow `--dir` for Arabic. |
| Header | Gains a shadow as the page scrolls, using the CSS scroll timeline. There is no script and the header height never changes. |
| Buttons and cards | Hover, press and focus change only colour, shadow and light, so the click target never moves. Hover effects apply only on devices that hover. |

All motion is off with `prefers-reduced-motion: reduce`.

## Tools reviewed (7 Oct 2026)

| Tool | Licence | Free limit | Used? |
| --- | --- | --- | --- |
| [Motion](https://motion.dev) | MIT. Motion+ (examples and premium components) is $399, one-time. | The library is free. | No. CSS covers what we need, and the `motion` component alone is about 34 kB. |
| [GSAP](https://gsap.com/licensing/) | Standard “No Charge” licence. All plugins are free. Building tools that compete with Webflow is not allowed. | Free for commercial use. | No. No scene needs a timeline engine. |
| [shadcn/ui](https://ui.shadcn.com) | MIT | Free | No. It is built on Tailwind and Radix, which this site doesn't use. |
| [21st.dev](https://21st.dev/pricing) | Each component keeps its author's licence. The free plan allows 2 copies a day. | Free plan | Reviewed only. The hero's pointer handling follows motion-primitives `Tilt` (MIT, © 2024 ibelick), rewritten without the library. `Magnetic` was rejected because it moves the click target. |
| [MotionSites.ai](https://motionsites.ai/terms) | Paid prompt library: $129 for 3 months, $279 a year or $399 lifetime. No free tier. Prompt text may not be redistributed. | None | No. |
| rembg 2.0.61 + isnet-general-use | MIT | Runs locally | Used once, to cut out the hero image. |

## Speed (11 Oct 2026, same machine, 3 Lighthouse runs each, median)

| | Mobile performance | Mobile LCP | CLS | Desktop performance |
| --- | --- | --- | --- | --- |
| Before (`main` d24ee83) | 83 | 4.70 s | 0 | 99 |
| After | 83 | 4.71 s | 0 | 99 |

These runs used a local server with Lighthouse's simulated slow phone. The live site on Vercel's CDN scored 89 on mobile before the change. Accessibility was 100 before and after.
