# Swap Engine frontend

## Run

From the Front-end worktree with Node.js 22 or newer:

```sh
npm ci
npm start
```

Open [localhost:3000](http://127.0.0.1:3000/). The default mode is simulation. The API creates real quote records on the local store. The alternative mode, regtest read-only, uses the existing backend configuration and node credentials outside the browser. For a separate local preview in PowerShell:

```powershell
$env:PORT = '4178'
$env:APP_MODE = 'simulation'
$env:DATA_DIR = Join-Path $env:TEMP ('swap-engine-preview-' + [guid]::NewGuid())
npm start
```

Open [localhost:4178](http://127.0.0.1:4178/). Run `npm run build:web` before starting the TypeScript server directly, including service-managed starts. The build generates the existing allowlisted `src/web/app.js`; the server also serves the checked-in HTML and CSS. The frontend needs no new static routes.

```sh
npm run build
npm test
npx playwright install chromium
npm run test:web
```

To use installed Edge from PowerShell, set `$env:WEB_TEST_BROWSER_CHANNEL = 'msedge'` before `npm run test:web`. The browser tests save screenshots in `dist/web-verification`. Set `$env:WEB_TEST_RECORD = '1'` to save a WebM of the full-screen opening, 3D entrance, manual drag and linked rotation. Browser recording requires Playwright's FFmpeg binary, which can be installed with `npx playwright install ffmpeg`.

Verified on Windows with Node.js 24 and Edge. The build succeeded, the Node suite passed 170 tests with 2 skips, and 5 browser tests passed. Browser coverage includes mouse drag, touch swipe, keyboard and selector changes, linked rotation, fast input bursts, stale quotes, expiry, axe scans, reduced motion and seven viewport sizes from 320 to 1440 pixels wide.

## Cube controls

SEND holds the principal and source selector. SWAP holds the fee breakdown and confirmation action. RECEIVE holds the destination selector and estimated receipt. Change a network in its native selector, drag or scroll vertically over the cube, or swipe its top control area on touch. On the rotation arrow, Down moves to the next rail and Up moves to the previous rail. A tap moves forward.

The rotation cycle is On-chain → Lightning → Liquid → On-chain. A direct selector change takes forward quarter turns through each intermediate rail. If both selected rails coincide, the opposite cube rotates forward to the next rail. Quotes wait for both outer cubes to settle. Existing quotes are discarded on rail and amount changes. Amount edits share a short debounce, and a stale response cannot update the face values.

## Product contracts

| Surface | Current behavior |
| --- | --- |
| Swap | `POST /v1/quotes` accepts integer `amountSats` from 10,000 to 1,000,000. Net receipt is principal minus estimated claim fee. Estimated user cost is invoice total minus net receipt. The provider funding reserve is omitted from user costs. Lightning routing fees are unknown. |
| Rails | Lightning → On-chain is the only quote route. On-chain → Lightning and routes involving Liquid can be selected and show an unavailable state. Execution is disabled because the reverse POST returns 503. |
| Status and history | The frontend leaves these unavailable until the backend can verify swap ownership. Contract data from public swap lookups is excluded. |
| Account | Optional same-origin session integration for the supplied login, session and logout contract. The baseline returns 404 for those endpoints, which disables sign-in. The browser keeps the CSRF token in memory and uses it for logout. It expects the session expiry in epoch milliseconds. |
| Operations | The UI requires a fresh verified ADMIN session before revealing the admin view. On a regtest read-only backend it can read preflight, including structured 503 reports. The role gate is a UI condition. The backend must authorize any future protected metrics, transaction or liquidity endpoint. |
| Reporting | Admin transaction lists, actual fees, earned fees, usable directional channel liquidity, HTLC counts, Alice node status, and revenue remain unavailable. Current aggregate on-chain and incoming liquidity do not establish the directional values required by the dashboard. |

The deployment baseline is `integration/reverse-swap-regtest` at `f9bac1a6cf34478109b680492008f39d00ab6e28`. Browser auth tests intercept the supplied contract and exercise sign-in, role verification and logout. They cannot verify the backend cookie flags, CSRF enforcement or role authorization until the backend routes land. The repo audit reports four inherited dependency advisories in bitcoinjs-lib, ecpair, valibot and Zod. Dependency remediation belongs to the backend integration work.

## Design and implementation references

The current direction uses white and black with architectural linework and six-sided CSS 3D cubes. A full-screen canvas draws six equal-weight strokes, applies rightward phase-shifted waves and interpolates to sampled letter outlines. The overlay fades into the cube entrance and clears after about 3.2 seconds. The keyboard-operable skip control opens the workspace immediately. Reduced motion opens at the working cubes and changes rails without animated turns. The composition, marks and glyph paths were authored for Swap Engine.

Visual review used typography hierarchy and grid alignment from independent showcases and Codrops' examples of interaction that respects reduced motion. Godly redirected to Recent Design, whose page could not be retrieved. [Awwwards](https://www.awwwards.com/) · [Godly](https://godly.website/) · [CSS Design Awards](https://www.cssdesignawards.com/) · [Hoverstat.es](https://www.hoverstat.es/) · [Siteinspire](https://www.siteinspire.com/) · [Codrops Creative Hub](https://tympanus.net/codrops/hub/) · [Codrops motion and accessibility](https://tympanus.net/codrops/2026/03/31/arnaud-roccas-portfolio-from-a-gsap-powered-motion-system-to-fluid-webgl/)

| Repository and inspected source | Technique and decision | License and maintenance |
| --- | --- | --- |
| [Boltz Web App](https://github.com/BoltzExchange/boltz-web-app), [SwapChecker.tsx](https://github.com/BoltzExchange/boltz-web-app/blob/main/src/components/SwapChecker.tsx) | SolidJS effects and teardown for per-swap subscriptions, plus distinct swap state. Keep state sourced from the backend and clear quote requests on input changes. No implication that the reference's accessibility was audited. | AGPL-3.0. No code, assets or layout reused. Latest GitHub push observed August 2026. |
| [Codrops Interlude](https://github.com/codrops/interlude), [controller](https://github.com/codrops/interlude/blob/main/src/lib/interlude/controller.ts), [media readiness](https://github.com/codrops/interlude/blob/main/src/lib/interlude/media.ts) | Astro lifecycle hooks coordinate GSAP transitions, while readiness logic limits image waits to the viewport. Keep our media finite and separate from navigation, rendering and form interaction. Three.js and Lenis were considered. | MIT. Preserve notices if code is redistributed. Latest observed push November 2026. |
| [Radix Primitives](https://github.com/radix-ui/primitives), [Dialog](https://github.com/radix-ui/primitives/blob/main/packages/react/dialog/src/dialog.tsx) | Focus scope, dismissable layer and trigger restoration are explicit React primitives. The native dialog covers modal focus and Escape on this stack and is tested by keyboard. | MIT. Preserve notices if code is redistributed. Latest observed push October 2026. |
| [visx](https://github.com/airbnb/visx), [Axis implementation](https://github.com/airbnb/visx/blob/master/packages/visx-axis/src/axis/Axis.tsx) | React SVG uses separate scale/tick generation and drawing with caller-provided formatting. This suits future authorized data with explicit units and a textual equivalent. No chart is drawn while reporting is unavailable. | MIT. Preserve notices if code is redistributed. Latest observed push June 2026. |
| [Lenis](https://github.com/darkroomengineering/lenis), [scroll core](https://github.com/darkroomengineering/lenis/blob/main/packages/core/src/lenis.ts) | Vanilla RAF animation, event hooks and prevent rules show the cost of managing scroll, nested areas and wheel input. The lab keeps native scrolling and animates only the hero. | MIT. Preserve notices if code is redistributed. Latest observed push November 2026. |

Registry comparison on 2026-11-18 found GSAP 3.15.1 with Flip and ScrollTrigger shipped as separate plugin imports under the GSAP standard license, Lenis 1.3.27, Motion 14.14.0 with React 18 or 19 integration, Three.js 0.187.0, and React Three Fiber 9.8.2 with React 19 and Three.js 0.156 or newer. Native CSS and Canvas meet the interaction and lifecycle requirements without a library. [GSAP Flip](https://gsap.com/docs/v3/Plugins/Flip/) · [GSAP ScrollTrigger](https://gsap.com/docs/v3/Plugins/ScrollTrigger/) · [Motion](https://www.npmjs.com/package/motion) · [Three.js](https://www.npmjs.com/package/three) · [React Three Fiber](https://www.npmjs.com/package/@react-three/fiber)

Manrope Variable and IBM Plex Mono are licensed under SIL OFL 1.1. The original license notices ship in the bundle with the Latin WOFF2 assets. No commercial typeface or third-party art is in the design. [Manrope OFL](https://github.com/google/fonts/blob/main/ofl/manrope/OFL.txt) · [IBM Plex Mono OFL](https://github.com/google/fonts/blob/main/ofl/ibmplexmono/OFL.txt)
