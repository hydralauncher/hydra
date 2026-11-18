# Hydra animations and transitions vs. Slint 1.18

See `decisions.md` for why Slint; this file says what each kind of effect costs to port.

An inventory of `src/renderer/src` (217 SCSS and 396 TSX files) and what each
kind of effect takes in Slint. Counts are from grep, taken 2026-11-07.

## Inventory

| Source | Count |
|---|---|
| `@keyframes` | 130 unique |
| `transition:` declarations | 395 |
| `animation:` declarations | 186 |
| framer-motion files | 21 (AnimatePresence 13, springs 8, `layoutId` 3, whileHover/Tap 4) |
| `requestAnimationFrame` files | 27 |
| `<canvas>` effect files | 15 |
| `backdrop-filter: blur` | 63 uses / 28 files |
| `filter:` (blur 31, brightness 26, saturate 9, drop-shadow 9, grayscale 4, invert 4) | 58 files |
| `mix-blend-mode` | 4 files |
| `mask` / `mask-image` | 7 files |
| `<video>` | 3 files |
| animated GIFs | 4 files |
| `text-shadow` | 10 files |

What the keyframes animate: transform 89, opacity 73, box-shadow 5,
background(-color) 6, width/height 4, background-position 3, filter 3,
stroke-dash 3, clip-path 2, backdrop-filter 2, content 1.

Transforms used: scale 111, translateY 90, rotate 78, translateX 54,
translate 32. No 3D anywhere (no perspective, rotateX/Y or preserve-3d).

Transition targets: background-color 109, color 78, opacity 75, all 73,
transform 60, border-color 48, width 18, filter 12, box-shadow 10,
max-height 8, visibility 7.

Easings: ease 492, linear 151, ease-in-out 49, ease-out 39, plus 15 custom
cubic-beziers (including overshoot ones like `.34,1.56,.64,1`) and 3 `steps()`.

## Works directly in Slint

| Hydra | Slint | Already built (hydra-desktop) |
|---|---|---|
| translate / scale / rotate keyframes and transitions | `x`/`y`, `transform-scale(-x/-y)`, `transform-rotation`, `transform-origin` | yes |
| opacity, color, background, border colors | `animate` on color / brush / float | yes |
| width / height / max-height collapse, `grid-template-rows 0fr→1fr` | `animate height` to `preferred-height` | sidebar sections |
| box-shadow glows and pulses, inset shadows | `drop-shadow-*`, `inner-shadow-*` (animatable) | buttons, frames |
| every easing Hydra uses, overshoot included | `cubic-bezier()`, named curves, elastic and bounce | yes |
| delays, infinite loops, `alternate` | `animate { delay; iteration-count; direction }`, `animation-tick()` | spinners, shimmer |
| linear / radial / conic gradients (classics rainbow, rank frames) | `@linear-`, `@radial-`, `@conic-gradient` | hero, cloud button |
| skeleton shimmer (`background-position`) | gradient rectangle moved by `animation-tick()` | yes |
| clip-path inset fills (classics stripes) | clipping rectangle with animated width | — |
| hover / press / focus states, whileHover / whileTap | `TouchArea.has-hover` / `pressed`, `FocusScope` | yes |
| count-up numbers (`use-animated-number`) | `animate` on an `int` property | — |
| smooth scroll, scrollIntoView, sticky, Intersection/ResizeObserver | `Flickable` + a tween `Timer`; layouts are reactive | gallery strip |
| carousels, drag momentum (embla, use-drag-scroll) | `TouchArea` pointer math + animated `x` | gallery, similar |
| progress rings (`stroke-dashoffset` on circles) | `Path` with computed `ArcTo` | — |
| `steps()` (launcher "..." dots) | `Timer` or `floor(progress * n)` | — |

## Works with extra code (pattern or Rust-side work)

| Hydra | Workaround | Cost |
|---|---|---|
| Animations on mount (most keyframes) | Slint animates property *changes*. Flip an `entered` flag one frame after creation | boilerplate per component (done in the modal) |
| Exit animations: AnimatePresence ×13, modal/toast/dropdown closing | `if`/`for` remove items instantly. Keep them mounted until the exit ends (`ModalController`, a "leaving" flag on model rows) | done for modals; lists need backend help |
| Multi-step choreography (achievement notification: 13 keyframes) | Chain with `delay`, or drive one progress value and interpolate by hand | more code than CSS |
| Re-triggered animations (vote pulse, number roll) | Parity counter trick (generation % 2 drives the direction) | done |
| framer-motion springs ×8 | No spring easing: `ease-out-back`/elastic, or simulate in a Rust `Timer` | approximation |
| `layoutId` shared indicator ×3 (tabs) | Animate the indicator's `x`/`width` from the selected tab | small |
| FLIP / list reflow (items sliding when siblings change) | Layouts snap. Position rows by index with `animate y` | manual layout |
| Animated GIFs ×4 (cloud, stars, flame) | Decode frames in Rust, swap the `Image` from a `Timer` | small |
| Backdrop blur over **static** images (library cards, hero panel, badges, profile hero) | Pre-blur a quarter-size copy in Rust, draw the matching slice (`Frost`) | done for the hero; extra memory per blurred card |
| Modal backdrop blur over the page | Window snapshot → blur on a worker → fade in | done; the page behind is frozen |
| `filter: blur()` on images (cover backdrops, classics) | Pre-blur in Rust | done |
| Blur-to-sharp image loading (progressive screenshots) | Crossfade the blurred and sharp copies | small |
| grayscale / invert / saturate on images | Precompute variants (crossfade if animated) | done (achievements) |
| `filter: brightness()` hover ×26 | Precomputed lighter colors, or a white/black overlay for opaque content | done (cloud button) |
| `drop-shadow()` on SVG icons ×9 | No alpha-shaped shadows: pre-render a shadowed raster, or stack a dark copy | per icon |
| `@property` animated gradient stops (leaderboard banner) | Animate the brush or stop colors directly | small |
| Canvas effects ×15 (confetti, sparks/embers, pixel art, XP bar, level seal, framed avatar, slam) | Particles as Rust-driven model items, or rasterize in Rust (tiny-skia) into a pixel buffer each frame. Slam's `getImageData`/`putImageData` effects become CPU work in Rust | rewrite each; CPU per frame |
| Path "draw-on" along complex shapes (`stroke-dasharray`, trails board intro) | Compute the partial path in Rust (lyon) | moderate |
| Gradient masks (fading edges: shop, leaderboards, missions) | Fake it with a gradient in the background color (solid backgrounds only) | small |
| Image-shaped masks (trophy, medal) | Precompute the masked image in Rust | static only |
| Dropdown / context-menu entrance | Animate content inside `PopupWindow`; closing is instant unless the popup is kept open | small |
| `text-shadow` ×10 | No text shadows: hard shadow from a duplicate `Text`; soft shadow needs a pre-rendered raster | approximation |

## Not possible in Slint itself

| Hydra | Why | Options |
|---|---|---|
| Video: inline trailers, lightbox playback, artwork picker previews, classics TV-noise overlay | No video element | Native decoder (AVFoundation/ffmpeg) pushing frames into an `Image` (a CPU→GPU copy per frame), or a native video layer composited under Slint via the rendering notifier |
| Live backdrop blur over **moving** content: video controls over playing video, toasts and notifications over the live page, glass panels over scrolling content | No backdrop filter and no shader/effect API | Opaque or translucent backgrounds |
| Animated blur on live elements (chat bubble jump-in/out and picker options animate `blur(8px)→0`) | No element filters | Drop the blur, keep the scale and fade |
| `mix-blend-mode` screen/overlay ×4 (TV-effect stripes, leaderboard and cloud-gift shine, gamification pills) | No blend modes | Alpha approximation; pre-composite when static |

## Takeaway

- About **85–90%** of the inventory (transforms, opacity, colors, sizes,
  shadows, gradients, easings, loops, hover/press) maps 1:1. The main
  difference is style: CSS keyframes run on mount and on unmount, while Slint
  animates property changes. Entrance and exit animations therefore need
  small reusable patterns (an `entered` flag, a closing controller), which
  `hydra-desktop` already has (`SlideIn`, `ModalController`).
- About **10%** needs Rust-side work: pre-blurred and filtered images,
  snapshot blur, GIF frames, canvas effects rewritten as Rust rendering,
  springs and FLIP by hand.
- About **5%** can't be done in Slint: **video**, **live backdrop blur over
  moving content**, **animated blur on live elements**, and **blend modes**.
  Video is the only one that blocks a feature; the rest have acceptable
  fallbacks (no blur, translucent backgrounds, alpha instead of blend).
