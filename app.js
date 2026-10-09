import { FilesetResolver, HandLandmarker, ImageSegmenter, FaceLandmarker } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";
import { BOUQUETS } from "./flowers.js?v=30";
import { PLAYLIST } from "./playlist.js?v=23";
import { SHOT_COUNTS, LAYOUTS, SIZES, THEMES, preloadFlowers, renderBooth, customTheme } from "./booth.js?v=63";

// ================= Settings =================
const FILTERS = [
  { id: "none", name: "Original", css: "none" },
  { id: "warm", name: "Warm", css: "sepia(.22) saturate(1.15) brightness(1.04)" },
  { id: "soft", name: "Soft", css: "contrast(.9) brightness(1.08) saturate(.92)" },
  { id: "mono", name: "Mono", css: "grayscale(1) contrast(1.08)" },
];
// Natural lip shades, muted like real tints (they're blended over the real lip colour)
const LIPS = [
  { id: "none", name: "None", color: null },
  { id: "bare", name: "Bare pink", color: "#C98C8C" },
  { id: "peach", name: "Peach", color: "#E0957A" },
  { id: "coral", name: "Soft coral", color: "#D9735F" },
  { id: "rosy", name: "Rosy", color: "#C9677A" },
  { id: "mauve", name: "Mauve", color: "#A86A78" },
  { id: "brick", name: "Brick", color: "#A84E3F" },
  { id: "cherry", name: "Cherry", color: "#B2303F" },
  { id: "berry", name: "Berry", color: "#8C2F4B" },
  { id: "plum", name: "Plum", color: "#73344A" },
];
const TIMERS = [0, 3, 5, 10];
const FRAMES_TO_TRIGGER = 3;   // a fist must last a few frames (no flicker)
const TUTORIAL_HOLD = 1.0;     // seconds of fist that complete the tutorial
const MAX_CANVAS_W = 1600;
const GRIP_NUDGE = 0.1;
// Bouquet size, set by the free hand's thumb–index gap (in palm lengths):
// gap ≤ pinch → min size, gap ≥ spread → max size, smooth in between.
const SIZE = { min: 1, max: 2.5, pinch: 0.35, spread: 1.1 };        // shifts the bouquet left on screen, × knuckle span

// Face mesh landmark indices (MediaPipe 478-point model)
const FACE = {
  lipsOuter: [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185],
  lipsInner: [78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308, 415, 310, 311, 312, 13, 82, 81, 80, 191],
  eyeL: [263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466],
  eyeR: [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246],
  browL: [276, 283, 282, 295, 285, 300, 293, 334, 296, 336],
  browR: [46, 53, 52, 65, 55, 70, 63, 105, 66, 107],
};

// ================= Elements & state =================
const $ = id => document.getElementById(id);
const video = $("video"), canvas = $("canvas"), ctx = canvas.getContext("2d");
const studio = $("studio"), stage = $("stage");
const offscreen = () => { const c = document.createElement("canvas"); return [c, c.getContext("2d")]; };
const [scene, sctx] = offscreen();      // everything is drawn here, then filtered onto the visible canvas
const [handLayer, hctx] = offscreen();
const [beautyLayer, bctx] = offscreen();
const [lipLayer, lctx] = offscreen();
const [skinMask, skinCtx] = offscreen();
const [faceMask, faceCtx] = offscreen();

const store = {
  get(k, d) { try { const v = localStorage.getItem("ff:" + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("ff:" + k, JSON.stringify(v)); } catch {} },
};

const state = {
  bouquet: BOUQUETS.find(b => b.id === store.get("bouquet")) || BOUQUETS[0],
  filter: FILTERS[0], mode: "photo", timer: 0, zoom: 1,
  beauty: false, smooth: 0.55, lip: LIPS[0], flowerScale: 1, boothShots: 4, sizeLocked: false, lockHold: 0, lastGap: 0,
  tutorial: true, holdTime: 0, busy: false, recorder: null,
};
BOUQUETS.forEach(b => (b.img = Object.assign(new Image(), { src: b.src })));

// ================= Models (start loading right away) =================
let hands, segmenter, faces;
(async () => {
  const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm");
  const base = path => ({ modelAssetPath: "https://storage.googleapis.com/mediapipe-models/" + path, delegate: "GPU" });
  [hands, segmenter, faces] = await Promise.all([
    HandLandmarker.createFromOptions(vision, { baseOptions: base("hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task"), runningMode: "VIDEO", numHands: 2 }),
    ImageSegmenter.createFromOptions(vision, { baseOptions: base("image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite"), runningMode: "VIDEO", outputConfidenceMasks: true, outputCategoryMask: false }),
    FaceLandmarker.createFromOptions(vision, { baseOptions: base("face_landmarker/face_landmarker/float16/1/face_landmarker.task"), runningMode: "VIDEO", numFaces: 1 }),
  ]);
  setStart("Open the studio →", true);
})();

// ================= Landing: one magazine "issue" per bouquet =================
let magIndex = Math.max(0, BOUQUETS.indexOf(state.bouquet)), magBusy = false;
const two = n => String(n + 1).padStart(2, "0");
const tint = (c, k, base = "#F4F0E8") => `color-mix(in srgb, ${c} ${k}%, ${base})`;
$("magThumbs").innerHTML = BOUQUETS.map((b, i) => `<li><button data-i="${i}"><span>${two(i)}</span><b>${b.name}</b><i></i><em>${b.meaning.split(" ")[0].replace(/[^A-Za-z]/g, "")}</em></button></li>`).join("");
function showIssue(i, dir = 1) {
  if (magBusy && i !== magIndex) return;
  magIndex = (i + BOUQUETS.length) % BOUQUETS.length;
  const b = BOUQUETS[magIndex], [c1, c2] = b.palette;
  const mag = $("landing");
  mag.style.setProperty("--tint", tint(c1, 18));
  mag.style.setProperty("--hero", tint(c1, 38, "#E8DFD0"));
  mag.style.setProperty("--accent", `color-mix(in srgb, ${c2} 58%, #1F1A17)`); // dark enough to stand out even for pale flowers
  $("magNo").textContent = $("magIssueTop").textContent = two(magIndex);
  $("magStickerImg").src = b.src;
  $("magName").textContent = b.name;
  $("magLatin").textContent = b.latin;
  $("magMeaning").textContent = b.meaning;
  $("magStory").textContent = b.story;
  $("magGive").textContent = b.giveWhen;
  $("magFig").textContent = `Fig. ${magIndex + 1} — ${b.name}, for ${b.meaning.toLowerCase()}`;
  $("magThumbs").querySelectorAll("button").forEach((t, k) => t.classList.toggle("active", k === magIndex));
  burstPetals(b.palette);
  // page turn: the current bouquet slides out, the new one rises in
  const img = $("magImg");
  if (!img.src) { img.src = b.src; img.alt = b.name; return; }
  // timers (not animation callbacks) drive the swap, so it never gets stuck if animations pause
  magBusy = true;
  img.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: `translateX(${-60 * dir}px) rotate(${-4 * dir}deg)` }], { duration: 260, easing: "ease-in", fill: "forwards" });
  setTimeout(() => {
    img.src = b.src; img.alt = b.name;
    img.getAnimations().forEach(a => a.cancel());
    img.animate([{ opacity: 0, transform: `translateX(${60 * dir}px) translateY(30px) rotate(${4 * dir}deg)` }, { opacity: 1, transform: "none" }], { duration: 520, easing: "cubic-bezier(.2,.9,.3,1.15)" });
  }, 260);
  setTimeout(() => (magBusy = false), 800);
}
$("magPrev").onclick = () => showIssue(magIndex - 1, -1);
$("magNext").onclick = () => showIssue(magIndex + 1, 1);
// contents: hovering (or focusing) an entry flips straight to it
const tocGo = e => { const t = e.target.closest("button"); if (t && +t.dataset.i !== magIndex) showIssue(+t.dataset.i, +t.dataset.i > magIndex ? 1 : -1); };
$("magThumbs").addEventListener("mouseover", tocGo);
$("magThumbs").addEventListener("focusin", tocGo);
$("magThumbs").onclick = tocGo;

// the bouquet leans toward the cursor, and can be dragged sideways to turn the page
const hero = $("magHero");
hero.addEventListener("pointermove", e => {
  if (drag) return;
  const r = hero.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
  $("magImg").style.transform = `rotate(${x * 6}deg) translate(${x * 14}px, ${y * 8}px)`;
});
hero.addEventListener("pointerleave", () => { if (!drag) $("magImg").style.transform = ""; });
let drag = null;
hero.addEventListener("pointerdown", e => { drag = { x: e.clientX }; hero.setPointerCapture(e.pointerId); hero.classList.add("grabbing"); });
hero.addEventListener("pointermove", e => { if (drag) $("magImg").style.transform = `translateX(${(e.clientX - drag.x) * 0.6}px) rotate(${(e.clientX - drag.x) * 0.03}deg)`; });
hero.addEventListener("pointerup", e => {
  if (!drag) return;
  const dx = e.clientX - drag.x; drag = null; hero.classList.remove("grabbing");
  $("magImg").style.transform = "";
  if (Math.abs(dx) > 60) showIssue(magIndex + (dx < 0 ? 1 : -1), dx < 0 ? 1 : -1);
});

// a little burst of petals in the bouquet's colours on every page turn
function burstPetals(colors) {
  const box = $("magPetals");
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  for (let i = 0; i < 14; i++) {
    const p = document.createElement("i");
    p.style.background = colors[i % 2];
    p.style.left = 30 + Math.random() * 40 + "%";
    p.style.top = 30 + Math.random() * 25 + "%";
    box.append(p);
    const dx = (Math.random() - 0.5) * 420, dy = 160 + Math.random() * 260, rot = (Math.random() - 0.5) * 720;
    p.animate([{ transform: "translate(0,0) rotate(0) scale(.4)", opacity: 0 }, { opacity: 1, offset: 0.15 }, { transform: `translate(${dx}px,${dy}px) rotate(${rot}deg) scale(1)`, opacity: 0 }],
      { duration: 1400 + Math.random() * 700, easing: "cubic-bezier(.2,.6,.4,1)" }).onfinish = () => p.remove();
  }
}
addEventListener("keydown", e => {
  if ($("landing").hidden || e.target.closest?.("input, textarea")) return;
  if (e.key === "ArrowRight") showIssue(magIndex + 1, 1);
  if (e.key === "ArrowLeft") showIssue(magIndex - 1, -1);
});
let wheelLock = 0;
$("landing").addEventListener("wheel", e => {
  if (matchMedia("(max-width: 900px)").matches) return; // stacked layout: the wheel just scrolls the page
  if (Date.now() < wheelLock || Math.abs(e.deltaY) + Math.abs(e.deltaX) < 20) return;
  wheelLock = Date.now() + 750;
  const d = (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) > 0 ? 1 : -1;
  showIssue(magIndex + d, d);
}, { passive: true });
showIssue(magIndex);

// ================= Landing → Studio =================
function setStart(label, enabled) {
  $("startBtn").disabled = !enabled;
  $("magStickerLabel").textContent = enabled ? "start" : label.replace("…", "").toLowerCase();
}
$("startBtn").onclick = async () => {
  setStart("Opening camera…", false);
  try {
    video.srcObject = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 } });
  } catch {
    setStart("Try again", true);
    toast("Couldn't open the camera. Check the camera permission in your browser.");
    return;
  }
  await new Promise(r => (video.readyState >= 2 ? r() : (video.onloadeddata = r)));
  selectBouquet(BOUQUETS[magIndex]);
  $("landing").hidden = true;
  studio.hidden = false;
  fitCanvas();
  if (!looping) { looping = true; requestAnimationFrame(loop); }
};
let looping = false;
// logo: back to the magazine, opened at the bouquet you're holding; the camera turns off
$("homeBtn").onclick = () => {
  if (state.recorder) stopRecording();
  video.srcObject?.getTracks().forEach(t => t.stop());
  video.srcObject = null;
  studio.hidden = true;
  $("landing").hidden = false;
  showIssue(BOUQUETS.indexOf(state.bouquet));
  setStart("Open the studio →", true);
};

// ================= Camera view: cover-crop + zoom =================
// The canvas fills the stage at any aspect ratio; we crop the video to cover it and zoom from the centre.
let view = { cx: 0, cy: 0, cw: 1, ch: 1 };
const vw = () => video.videoWidth, vh = () => video.videoHeight;
function updateView() {
  const W = canvas.width, H = canvas.height, sa = W / H, va = vw() / vh();
  let cw = sa > va ? vw() : vh() * sa;
  let ch = sa > va ? vw() / sa : vh();
  cw /= state.zoom; ch /= state.zoom;
  view = { cx: (vw() - cw) / 2, cy: (vh() - ch) / 2, cw, ch };
}
// normalised video landmark → canvas pixel (unmirrored; the whole scene is mirrored at draw time)
const toCanvas = p => ({ x: (p.x * vw() - view.cx) * canvas.width / view.cw, y: (p.y * vh() - view.cy) * canvas.height / view.ch });
// draw a source that covers the whole video frame (the video itself or a mask of any resolution)
function drawCropped(c, src, sw = vw(), sh = vh()) {
  const kx = sw / vw(), ky = sh / vh();
  c.drawImage(src, view.cx * kx, view.cy * ky, view.cw * kx, view.ch * ky, 0, 0, canvas.width, canvas.height);
}
function fitCanvas() {
  if (state.recorder || !vw()) return; // never resize mid-recording
  const dpr = Math.min(devicePixelRatio || 1, 2);
  let w = stage.clientWidth * dpr, h = stage.clientHeight * dpr;
  const k = Math.min(1, MAX_CANVAS_W / w);
  w = Math.round(w * k); h = Math.round(h * k);
  for (const c of [canvas, scene, handLayer, beautyLayer, lipLayer]) { c.width = w; c.height = h; }
  updateView();
}
new ResizeObserver(fitCanvas).observe(stage);

// ================= Zoom =================
function setZoom(z) {
  state.zoom = Math.min(3, Math.max(1, z));
  $("zoomOut").disabled = state.zoom <= 1;
  $("zoomIn").disabled = state.zoom >= 3;
  updateView();
}
$("zoomIn").onclick = () => setZoom(state.zoom + 0.25);
$("zoomOut").onclick = () => setZoom(state.zoom - 0.25);
stage.addEventListener("wheel", e => { e.preventDefault(); setZoom(state.zoom * Math.exp(-e.deltaY * 0.0015)); }, { passive: false });

// ================= Tutorial: one card per gesture, ring fills when the camera sees it =================
const TUTORIAL = [
  { img: "tutorial-fist", title: "Make a fist", steps: ["Raise your hand in front of the camera", "Close it into a fist, as if holding a stem", "Hold still until the ring fills up"] },
  { img: "tutorial-shrink", title: "Pinch to shrink", steps: ["Keep holding the bouquet", "With your other hand, curl the last three fingers", "Touch your thumb to your index finger"] },
  { img: "tutorial-grow", title: "Spread to grow", steps: ["Keep the same pose", "Open your thumb and index finger into an L", "Wider means a bigger bouquet"] },
  { img: "tutorial-lock", title: "Open palm to lock", steps: ["Happy with the size?", "Show an open palm and hold it", "The size now stays, even in someone else's hand"] },
  { img: "tutorial-unlock", title: "Peace sign to unlock", steps: ["Want to resize again?", "Show a peace sign and hold it", "Pinch or spread to change the size"] },
];
let tutStep = 0;
$("tutDots").innerHTML = TUTORIAL.map(() => "<i></i>").join("");
function showTutStep(n) {
  tutStep = n; state.holdTime = 0; state.tutDone = false;
  const t = TUTORIAL[n];
  $("tutImg").src = `assets/${t.img}.png`;
  $("tutImg").alt = t.title;
  $("tutorialTitle").textContent = t.title;
  $("tutSteps").innerHTML = t.steps.map(x => `<li>${x}</li>`).join("");
  $("poseProgress").style.strokeDashoffset = 289;
  document.querySelectorAll("#tutDots i").forEach((d, k) => d.classList.toggle("on", k === n));
  $("tutBack").hidden = n === 0;
  $("tutNext").textContent = n === TUTORIAL.length - 1 ? "Done" : "Next";
  const step = $("tutStep");
  step.style.animation = "none"; void step.offsetWidth; step.style.animation = "";
}
function finishTutorial() { state.tutorial = false; $("tutorial").classList.add("done"); }
$("skipTutorial").onclick = finishTutorial;
$("tutNext").onclick = () => (tutStep === TUTORIAL.length - 1 ? finishTutorial() : showTutStep(tutStep + 1));
$("tutBack").onclick = () => showTutStep(tutStep - 1);
$("helpBtn").onclick = () => { state.tutorial = true; showTutStep(0); $("tutorial").classList.remove("done"); };
showTutStep(0);
// called every frame with what the camera sees; fills the ring while the step's gesture is held
function updateTutorial(seen, dt) {
  const done = [
    seen.holding,
    seen.holding && seen.pinched,
    seen.holding && state.flowerScale > 1.9,
    state.sizeLocked,
    seen.unlocked,
  ][tutStep];
  if (state.tutDone) return; // ring stays full until the next card shows
  // a frame or two of missed detection only drains the ring slowly, so it doesn't stutter
  state.holdTime = done ? state.holdTime + dt : Math.max(0, state.holdTime - dt * 0.35);
  const p = Math.min(1, state.holdTime / TUTORIAL_HOLD);
  $("poseProgress").style.strokeDashoffset = 289 * (1 - p);
  if (p >= 1) {
    state.tutDone = true;
    $("tutorialTitle").textContent = "Lovely! 🌸";
    setTimeout(() => (tutStep === TUTORIAL.length - 1 ? finishTutorial() : showTutStep(tutStep + 1)), 700);
  }
}

// ================= Vision helpers =================
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
// fist = all four fingertips closer to the wrist than their middle joints
const curled = (w, tip, pip) => dist(w[tip], w[0]) < dist(w[pip], w[0]);
// fist = all four fingertips closer to the wrist than their middle joints
const isFist = w => [[8, 6], [12, 10], [16, 14], [20, 18]].every(([t, p]) => curled(w, t, p));
// thumb–index gap of the free hand, normalised by palm length (wrist → middle knuckle),
// which stays stable when the hand turns sideways, unlike the knuckle span
// (thumb tip to the index tip OR its last joint, whichever is closer: the tip is often hidden in a pinch)
// resize pose: middle, ring and pinky curled (only thumb + index move)
const resizePose = w => [[12, 10], [16, 14], [20, 18]].every(([t, p]) => curled(w, t, p));
// stop pose: open palm, all four fingers straight
const openPalm = w => [[8, 6], [12, 10], [16, 14], [20, 18]].every(([t, p]) => !curled(w, t, p));
// unlock pose: peace sign (index + middle up, ring + pinky curled)
const peace = w => !curled(w, 8, 6) && !curled(w, 12, 10) && curled(w, 16, 14) && curled(w, 20, 18);
const LOCK_HOLD = 0.5; // seconds a lock/unlock pose must be held
const pinchGap = w => Math.min(dist(w[4], w[8]), dist(w[4], w[7])) / dist(w[0], w[9]);
const easeOutBack = t => 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2);
const lerp = (a, b, t) => a + (b - a) * t;

function convexHull(pts) {
  pts = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const half = list => {
    const out = [];
    for (const p of list) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  return [...half(pts), ...half([...pts].reverse())];
}
function tracePath(c, pts, grow = 1) {
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length, cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  pts.forEach((p, i) => c[i ? "lineTo" : "moveTo"](cx + (p.x - cx) * grow, cy + (p.y - cy) * grow));
  c.closePath();
}

// Segmenter confidence mask (one class) → alpha-only canvas, smoothstep for soft but tight edges
function maskInto(mask, cv, cctx) {
  const { width: w, height: h } = mask;
  const conf = mask.getAsFloat32Array();
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; cv._img = cctx.createImageData(w, h); }
  const d = cv._img.data;
  for (let i = 0; i < conf.length; i++) {
    const t = Math.min(1, Math.max(0, (conf[i] - 0.3) / 0.4));
    d[i * 4 + 3] = 255 * t * t * (3 - 2 * t);
  }
  cctx.putImageData(cv._img, 0, 0);
}
function runSegmenter(now, wantFace) {
  segmenter.segmentForVideo(video, now, r => {
    maskInto(r.confidenceMasks[2], skinMask, skinCtx);              // body skin → hands
    if (wantFace) maskInto(r.confidenceMasks[3], faceMask, faceCtx); // face skin → beauty
  });
}

// ================= Beauty filter =================
function drawBeauty(c, face) {
  const W = canvas.width, H = canvas.height;
  const pts = idx => idx.map(i => toCanvas(face[i]));

  // 1) smooth skin: a blurred copy of the face, only where the segmenter sees face skin,
  //    with eyes/brows/lips cut out. It's blended with "lighten", so it only lifts darker
  //    spots (blemishes, pore shadows) and keeps the real skin texture and highlights.
  bctx.clearRect(0, 0, W, H);
  bctx.save();
  bctx.filter = `blur(${Math.max(2, W / 400)}px)`; // feathered mask edge
  drawCropped(bctx, faceMask, faceMask.width, faceMask.height);
  bctx.globalCompositeOperation = "source-in";
  bctx.filter = `blur(${Math.max(2, W / 360)}px) brightness(1.02)`;
  drawCropped(bctx, video);
  bctx.filter = "none";
  bctx.globalCompositeOperation = "destination-out";
  bctx.beginPath();
  for (const [idx, g] of [[FACE.eyeL, 1.6], [FACE.eyeR, 1.6], [FACE.browL, 1.4], [FACE.browR, 1.4], [FACE.lipsOuter, 1.08]])
    tracePath(bctx, convexHull(pts(idx)), g);
  bctx.fill();
  bctx.restore();
  c.save();
  c.globalCompositeOperation = "lighten";
  c.globalAlpha = 0.65 * state.smooth;        // even at full it stays skin, not plastic
  c.drawImage(beautyLayer, 0, 0);
  c.globalCompositeOperation = "source-over";
  c.globalAlpha = 0.2 * state.smooth;         // a touch of even-toning on top
  c.drawImage(beautyLayer, 0, 0);
  c.restore();

  // 2) lip tint: a feathered lip mask, stronger towards the inner lip line (soft ombré),
  //    blended with "multiply" + "color" so the real lip texture and shading show through
  if (!state.lip.color) return;
  const outer = pts(FACE.lipsOuter), inner = pts(FACE.lipsInner);
  const cx = inner.reduce((t, p) => t + p.x, 0) / inner.length, cy = inner.reduce((t, p) => t + p.y, 0) / inner.length;
  const r = Math.max(...outer.map(p => Math.hypot(p.x - cx, p.y - cy)));
  lctx.clearRect(0, 0, W, H);
  lctx.save();
  lctx.filter = `blur(${Math.max(1.5, W / 450)}px)`;
  const grad = lctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  grad.addColorStop(0, state.lip.color);
  grad.addColorStop(0.55, state.lip.color + "E6");
  grad.addColorStop(1, state.lip.color + "66");
  lctx.fillStyle = grad;
  lctx.beginPath();
  outer.forEach((p, i) => lctx[i ? "lineTo" : "moveTo"](p.x, p.y));
  lctx.closePath();
  inner.forEach((p, i) => lctx[i ? "lineTo" : "moveTo"](p.x, p.y));
  lctx.closePath();
  lctx.fill("evenodd");
  lctx.restore();
  c.save();
  c.globalCompositeOperation = "multiply"; c.globalAlpha = 0.42; c.drawImage(lipLayer, 0, 0);
  c.globalCompositeOperation = "color"; c.globalAlpha = 0.38; c.drawImage(lipLayer, 0, 0);
  c.restore();
}

// ================= Main loop =================
let fistFrames = 0, sizeBadgeTimer, grow = 0, pos = null, lastTime = performance.now(), frame = 0;

function loop(now) {
  requestAnimationFrame(loop);
  if (video.readyState < 2) return;
  const dt = Math.min(0.1, (now - lastTime) / 1000);
  lastTime = now;
  const W = canvas.width, H = canvas.height;

  // up to two hands: the fist holds the bouquet, the other hand (if any) sets its size
  const t0 = performance.now();
  const res = hands.detectForVideo(video, now);
  const detectMs = performance.now() - t0;
  // A pinch curls the index finger too, so the resizing hand can also look like a fist.
  // If both qualify, the real holder is the one whose thumb is NOT touching the index tip.
  const fists = res.worldLandmarks.map((w, i) => i).filter(i => isFist(res.worldLandmarks[i]));
  let hold = -1;
  if (fists.length === 1) hold = fists[0];
  else if (fists.length > 1) {
    // keep the bouquet in the hand nearest to where it already is; otherwise pick the hand whose thumb isn't pinching
    const near = i => { const c = toCanvas(res.landmarks[i][9]); return Math.hypot(c.x - pos.x, c.y - pos.y); };
    hold = pos && grow > 0
      ? fists.reduce((a, b) => (near(b) < near(a) ? b : a))
      : fists.reduce((a, b) => (pinchGap(res.worldLandmarks[b]) > pinchGap(res.worldLandmarks[a]) ? b : a));
  }
  const lm = hold >= 0 ? res.landmarks[hold] : null;
  const free = hold >= 0 ? res.worldLandmarks.findIndex((w, i) => i !== hold) : -1;
  fistFrames = lm ? fistFrames + 1 : 0;
  const show = fistFrames >= FRAMES_TO_TRIGGER;
  const freeW = free >= 0 ? res.worldLandmarks[free] : null;
  // The size belongs to the bouquet, not the hand: it survives switching hands or people.
  // Open palm (held) locks it; once locked only a held peace sign unlocks it.
  const lockPose = show && freeW && (state.sizeLocked ? peace(freeW) : openPalm(freeW));
  state.lockHold = lockPose ? state.lockHold + dt : 0;
  let unlocked = false;
  if (state.lockHold >= LOCK_HOLD) { unlocked = state.sizeLocked; state.sizeLocked = !state.sizeLocked; state.lockHold = 0; showSizeBadge(); }
  if (show && freeW && !state.sizeLocked && resizePose(freeW)) {
    const t = Math.min(1, Math.max(0, (pinchGap(res.worldLandmarks[free]) - SIZE.pinch) / (SIZE.spread - SIZE.pinch)));
    state.flowerScale = lerp(state.flowerScale, SIZE.min + t * (SIZE.max - SIZE.min), 0.18);
    state.lastGap = pinchGap(res.worldLandmarks[free]);
    showSizeBadge();
  }
  if (state.tutorial) {
    state.tutUnlocked = state.tutUnlocked || unlocked;
    updateTutorial({ holding: show, pinched: !!(freeW && resizePose(freeW) && pinchGap(freeW) < SIZE.pinch + 0.05), unlocked: state.tutUnlocked }, dt);
    if (tutStep !== 4) state.tutUnlocked = false;
  }
  grow = Math.min(1, Math.max(0, grow + (show ? dt * 2.5 : -dt * 4)));

  const holding = lm && grow > 0;
  if (holding || state.beauty) runSegmenter(now, state.beauty);
  const face = state.beauty ? faces.detectForVideo(video, now).faceLandmarks[0] : null;

  if (lm) {
    const P = i => toCanvas(lm[i]);
    // the fist is a tube: stems run along the pinky (17) → index (5) knuckle axis.
    // Its hollow sits inside the curled fingers, so the grip is the centroid of all
    // finger joints (knuckles, middle joints, end joints and the tucked-in tips).
    const core = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20].map(P);
    const t = {
      x: core.reduce((s, p) => s + p.x, 0) / core.length,
      y: core.reduce((s, p) => s + p.y, 0) / core.length,
      dx: P(5).x - P(17).x, dy: P(5).y - P(17).y,
    };
    t.size = Math.hypot(t.dx, t.dy);
    t.x += GRIP_NUDGE * t.size; // canvas +x is screen-left (the scene is mirrored)
    pos = pos
      ? { x: lerp(pos.x, t.x, 0.4), y: lerp(pos.y, t.y, 0.4), dx: lerp(pos.dx, t.dx, 0.3), dy: lerp(pos.dy, t.dy, 0.3), size: lerp(pos.size, t.size, 0.2) }
      : t;
  }

  sctx.save();
  sctx.translate(W, 0); sctx.scale(-1, 1); // selfie mirror
  drawCropped(sctx, video);
  if (face) drawBeauty(sctx, face);

  const b = state.bouquet;
  if (pos && grow > 0 && b.img.complete) {
    const s = easeOutBack(grow);
    const h = pos.size * b.size * s * state.flowerScale, w = h * b.img.width / b.img.height;
    // bouquet behind the hand
    sctx.save();
    sctx.globalAlpha = Math.min(1, grow * 2);
    sctx.translate(pos.x, pos.y);
    sctx.rotate(Math.atan2(pos.dx, -pos.dy));
    sctx.scale(-1, 1); // un-mirror the photo
    sctx.drawImage(b.img, -w * b.grip.x, -h * b.grip.y, w, h);
    sctx.restore();

    // hands on top: per-pixel skin mask, limited to the area around each detected hand
    if (lm) {
      hctx.clearRect(0, 0, W, H);
      hctx.save();
      hctx.beginPath();
      for (const hand of res.landmarks) tracePath(hctx, convexHull(hand.map(toCanvas)), 1.35);
      hctx.clip();
      hctx.filter = "blur(1.5px)";
      drawCropped(hctx, skinMask, skinMask.width, skinMask.height);
      hctx.filter = "none";
      hctx.globalCompositeOperation = "source-in";
      drawCropped(hctx, video);
      hctx.restore();
      sctx.drawImage(handLayer, 0, 0);
    }
  }
  sctx.restore();

  // colour filter over the whole picture (video, bouquet and hand)
  ctx.filter = state.filter.css;
  ctx.drawImage(scene, 0, 0);
  ctx.filter = "none";
  if (DEBUG) drawDebug(res, hold, detectMs, dt);

  if (frame++ % 4 === 0) drawFilterPreviews();
}

// ================= ?debug: what the vision models see =================
const DEBUG = new URLSearchParams(location.search).has("debug");
const BONES = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]];
let fps = 0;
function drawDebug(res, hold, ms, dt) {
  const W = canvas.width, u = Math.max(2, W / 520);
  const M = p => { const c = toCanvas(p); return { x: W - c.x, y: c.y }; }; // the picture on screen is mirrored
  fps = lerp(fps, 1 / Math.max(dt, 1e-3), 0.1);
  ctx.save();
  ctx.lineWidth = u; ctx.lineJoin = "round";
  ctx.font = `600 ${7 * u}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  res.landmarks.forEach((hand, i) => {
    const pts = hand.map(M), w = res.worldLandmarks[i];
    const label = i === hold ? "FIST · holding"
      : isFist(w) ? "fist" : peace(w) ? "peace" : openPalm(w) ? "open palm"
      : resizePose(w) ? `pinch gap ${pinchGap(w).toFixed(2)}` : "hand";
    const col = i === hold ? "#FF5C8A" : "#4DE1FF";
    ctx.strokeStyle = col;
    ctx.setLineDash([3 * u, 3 * u]);                         // hull that limits the skin mask
    ctx.beginPath(); tracePath(ctx, convexHull(pts), 1.35); ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();                                          // 21-point skeleton
    for (const [a, b] of BONES) { ctx.moveTo(pts[a].x, pts[a].y); ctx.lineTo(pts[b].x, pts[b].y); }
    ctx.stroke();
    ctx.fillStyle = "#fff";
    for (const p of pts) { ctx.beginPath(); ctx.arc(p.x, p.y, 1.8 * u, 0, 7); ctx.fill(); }
    const top = pts.reduce((a, p) => (p.y < a.y ? p : a)), tw = ctx.measureText(label).width;
    ctx.fillStyle = "rgba(20,14,10,.7)";
    ctx.fillRect(top.x - tw / 2 - 4 * u, top.y - 19 * u, tw + 8 * u, 11 * u);
    ctx.fillStyle = col; ctx.fillText(label, top.x - tw / 2, top.y - 11 * u);
  });
  if (pos && grow > 0) {                                     // grip point + stem axis
    const x = W - pos.x, r = pos.size * 0.3;
    ctx.strokeStyle = "#FFD23F"; ctx.lineWidth = 1.5 * u;
    ctx.beginPath(); ctx.arc(x, pos.y, r * 0.35, 0, 7);
    ctx.moveTo(x + pos.dx * 0.9, pos.y + pos.dy * 0.9); ctx.lineTo(x - pos.dx * 0.9, pos.y - pos.dy * 0.9);
    ctx.stroke();
  }
  const lines = [`hands ${res.landmarks.length}`, `hand model ${ms.toFixed(1)} ms`, `${fps.toFixed(0)} fps`,
    `scale ${state.flowerScale.toFixed(2)}×${state.sizeLocked ? " locked" : ""}`];
  ctx.fillStyle = "rgba(20,14,10,.6)";
  ctx.fillRect(8 * u, 8 * u, 92 * u, (lines.length * 10 + 6) * u);
  ctx.fillStyle = "#fff";
  lines.forEach((t, i) => ctx.fillText(t, 13 * u, (19 + i * 10) * u));
  ctx.restore();
}

function showSizeBadge() {
  const el = $("sizeBadge");
  el.textContent = state.sizeLocked
    ? `Size ${state.flowerScale.toFixed(1)}× · locked (✌️ to unlock)`
    : `Size ${state.flowerScale.toFixed(1)}× · gap ${state.lastGap.toFixed(2)}`; // gap shown for calibration
  el.hidden = false;
  clearTimeout(sizeBadgeTimer);
  sizeBadgeTimer = setTimeout(() => (el.hidden = true), 900);
}

// ================= Bouquets panel =================
function renderBouquets() {
  $("flowerGrid").innerHTML = "";
  $("flowerRail").innerHTML = "";
  for (const b of BOUQUETS) {
    const card = document.createElement("button");
    card.className = "flower-card";
    card.dataset.id = b.id;
    card.innerHTML = `<img src="${b.src}" alt=""><span>${b.name}</span>`;
    card.onclick = () => openDetail(b);
    $("flowerGrid").append(card);

    const dot = document.createElement("button");
    dot.dataset.id = b.id;
    dot.title = b.name;
    dot.setAttribute("aria-label", b.name);
    dot.innerHTML = `<img src="${b.src}" alt="">`;
    dot.onclick = () => selectBouquet(b);
    $("flowerRail").append(dot);
  }
}
function selectBouquet(b) {
  if (state.bouquet !== b) { state.flowerScale = 1; state.sizeLocked = false; } // a new bouquet starts at its normal size
  state.bouquet = b;
  store.set("bouquet", b.id);
  document.querySelectorAll("[data-id]").forEach(el => el.classList.toggle("active", el.dataset.id === b.id));
  $("nowHolding").textContent = "Holding: " + b.name;
}
renderBouquets();
selectBouquet(state.bouquet);

$("leftToggle").onclick = () => {
  const collapsed = studio.classList.toggle("left-collapsed");
  $("leftToggle").setAttribute("aria-label", collapsed ? "Expand bouquet panel" : "Collapse bouquet panel");
  store.set("leftCollapsed", collapsed);
};
$("rightToggle").onclick = () => {
  const collapsed = studio.classList.toggle("right-collapsed");
  $("rightToggle").setAttribute("aria-label", collapsed ? "Show controls panel" : "Hide controls panel");
  store.set("rightCollapsed", collapsed);
};
// phones stack everything, so the desktop collapse state only applies on wide screens
const phone = matchMedia("(max-width: 900px)");
function applyCollapse() {
  studio.classList.toggle("left-collapsed", !phone.matches && store.get("leftCollapsed", false));
  studio.classList.toggle("right-collapsed", !phone.matches && store.get("rightCollapsed", false));
}
applyCollapse();
phone.addEventListener("change", applyCollapse);

// ================= Flower meaning (inside the bouquet panel) =================
let detailIndex = 0;
function openDetail(b) {
  detailIndex = BOUQUETS.indexOf(b);
  selectBouquet(b);
  $("detailImg").src = b.src;
  $("detailImg").alt = b.name;
  $("detailName").textContent = b.name;
  $("detailCount").textContent = `${detailIndex + 1} / ${BOUQUETS.length}`;
  $("detailLatin").textContent = b.latin;
  $("detailMeaning").textContent = b.meaning;
  $("detailStory").textContent = b.story;
  $("detailGive").textContent = b.giveWhen;
  $("detailCircle").style.background = `radial-gradient(circle, ${b.palette[0]}, ${b.palette[1]})`;
  $("detailPalette").innerHTML = b.palette.map(c => `<i style="background:${c}" title="${c}"></i>`).join("");
  $("flowerGrid").hidden = true;
  $("detail").hidden = false;
  $("detailBack").hidden = false;
  $("panelTitle").textContent = "Meaning";
  $("leftPanel").scrollTop = 0;
}
function closeDetail() {
  $("detail").hidden = true;
  $("flowerGrid").hidden = false;
  $("detailBack").hidden = true;
  $("panelTitle").textContent = "Bouquets";
}
$("detailBack").onclick = closeDetail;
$("detailPrev").onclick = () => openDetail(BOUQUETS[(detailIndex - 1 + BOUQUETS.length) % BOUQUETS.length]);
$("detailNext").onclick = () => openDetail(BOUQUETS[(detailIndex + 1) % BOUQUETS.length]);

// ================= Resizable panels =================
const LIMITS = { left: [200, 420], right: [270, 440] };
const savedCols = store.get("cols", null);
if (savedCols) { studio.style.setProperty("--left", savedCols.left + "px"); studio.style.setProperty("--right", savedCols.right + "px"); }
document.querySelectorAll(".gutter").forEach(g => {
  g.onpointerdown = e => {
    const side = g.dataset.side;
    if (studio.classList.contains(side + "-collapsed")) return;
    const start = e.clientX;
    const startW = parseFloat(getComputedStyle(studio).getPropertyValue("--" + side));
    g.setPointerCapture(e.pointerId);
    studio.classList.add("dragging");
    g.onpointermove = ev => {
      const dx = (ev.clientX - start) * (side === "left" ? 1 : -1);
      const [lo, hi] = LIMITS[side];
      studio.style.setProperty("--" + side, Math.min(hi, Math.max(lo, startW + dx)) + "px");
    };
    g.onpointerup = () => {
      g.onpointermove = g.onpointerup = null;
      studio.classList.remove("dragging");
      const cs = getComputedStyle(studio);
      store.set("cols", { left: parseFloat(cs.getPropertyValue("--left")), right: parseFloat(cs.getPropertyValue("--right")) });
    };
  };
  g.ondblclick = () => { studio.style.removeProperty("--left"); studio.style.removeProperty("--right"); store.set("cols", null); };
});

// ================= Filters & beauty =================
function makeChoice(el, items, render, onPick, active) {
  el.innerHTML = "";
  for (const item of items) {
    const btn = document.createElement("button");
    render(btn, item);
    btn.classList.toggle("active", item === active);
    btn.onclick = () => {
      el.querySelectorAll("button").forEach(x => x.classList.remove("active"));
      btn.classList.add("active");
      onPick(item);
    };
    el.append(btn);
  }
}
makeChoice($("filterPicker"), FILTERS, (btn, f) => {
  btn.innerHTML = `<canvas width="160" height="100"></canvas><span>${f.name}</span>`;
  f.preview = btn.querySelector("canvas").getContext("2d");
}, f => (state.filter = f), state.filter);
function drawFilterPreviews() {
  for (const f of FILTERS) {
    const c = f.preview;
    c.save();
    c.filter = f.css;
    c.translate(160, 0); c.scale(-1, 1);
    // centre of the stage's crop, cut to the thumbnail's shape so it never squashes
    const sw = Math.min(view.cw, view.ch * 1.6), sh = sw / 1.6;
    c.drawImage(video, view.cx + (view.cw - sw) / 2, view.cy + (view.ch - sh) / 2, sw, sh, 0, 0, 160, 100);
    c.restore();
  }
}

makeChoice($("lipSwatches"), LIPS, (btn, l) => {
  btn.title = l.name;
  btn.setAttribute("aria-label", "Lip tint: " + l.name);
  if (l.color) btn.style.background = l.color; else btn.textContent = "∅";
}, l => { state.lip = l; setBeauty(true); }, state.lip);
// touching any beauty control switches beauty on
function setBeauty(on) {
  state.beauty = on;
  $("beautyOn").checked = on;
  $("beautyControls").classList.toggle("off", !on);
}
$("beautyOn").onchange = e => setBeauty(e.target.checked);
$("smoothRange").oninput = e => { state.smooth = +e.target.value; setBeauty(true); };
setBeauty(false);

// ================= Capture =================
$("timerBtn").onclick = () => {
  state.timer = TIMERS[(TIMERS.indexOf(state.timer) + 1) % TIMERS.length];
  $("timerBtn").textContent = state.timer ? `Timer ${state.timer}s` : "Timer off";
  $("timerBtn").classList.toggle("active", state.timer > 0);
};
document.querySelectorAll(".segmented button").forEach(btn => {
  btn.onclick = () => {
    if (state.recorder) return;
    document.querySelectorAll(".segmented button").forEach(x => x.classList.remove("active"));
    btn.classList.add("active");
    state.mode = btn.dataset.mode;
    $("shutter").classList.toggle("video", state.mode === "video");
    $("shotsPick").hidden = state.mode !== "booth";
    $("shutter").setAttribute("aria-label", { photo: "Take photo", video: "Start recording", booth: "Start photo booth" }[state.mode]);
  };
});
$("shutter").onclick = async () => {
  if (state.recorder) return stopRecording();
  if (state.busy) return;
  state.busy = true;
  if (state.mode === "booth") { await runBooth(); state.busy = false; return; }
  await countdown(state.timer);
  state.busy = false;
  state.mode === "photo" ? takePhoto() : startRecording();
};
async function countdown(sec) {
  const el = $("countdown");
  for (let i = sec; i > 0; i--) {
    el.hidden = false; el.textContent = i;
    await new Promise(r => setTimeout(r, 1000));
  }
  el.hidden = true;
}
// ================= Photo booth =================
const booth = { shots: [], layout: LAYOUTS[0], theme: THEMES[1], size: SIZES[0] };
$("shotsPick").innerHTML = SHOT_COUNTS.map(n => `<button data-n="${n}" class="${n === 4 ? "active" : ""}">${n}</button>`).join("");
$("shotsPick").onclick = e => {
  const b = e.target.closest("button"); if (!b) return;
  state.boothShots = +b.dataset.n;
  $("shotsPick").querySelectorAll("button").forEach(x => x.classList.toggle("active", x === b));
};
const custom = { bg: "#F3E3EA", flowers: ["tulip-putih", "peony-blush"], petals: true };
const CUSTOM_COLORS = ["#FFFFFF", "#F7EFE4", "#F3E3EA", "#F6D9DE", "#FFF3CF", "#EEF3E2", "#E3ECF5", "#D9BE9C", "#2B211B"];
preloadFlowers(BOUQUETS.map(b => b.id));
const customThemeNow = () => customTheme(custom.bg, custom.flowers, custom.petals);
function flash() { const f = $("flash"); f.classList.remove("go"); void f.offsetWidth; f.classList.add("go"); }
function canvasBlank() {
  const p = ctx.getImageData(canvas.width >> 1, canvas.height >> 1, 1, 1).data;
  return p[3] === 0;
}
// snapshot of the visible camera (with bouquet, beauty and filter), cropped to 4:3
function snapshot() {
  const W = canvas.width, H = canvas.height;
  const cw = Math.min(W, H * 4 / 3), ch = cw * 3 / 4;
  const c = document.createElement("canvas");
  c.width = 960; c.height = 720;
  c.getContext("2d").drawImage(canvas, (W - cw) / 2, (H - ch) / 2, cw, ch, 0, 0, 960, 720);
  return c;
}
async function runBooth() {
  booth.shots = [];
  for (let i = 0; i < state.boothShots; i++) {
    $("boothCount").hidden = false;
    $("boothCount").textContent = `${i + 1} / ${state.boothShots}`;
    await countdown(state.timer || 3);
    // a layout change can clear the canvas: wait until a camera frame is drawn again
    for (let t = 0; t < 20 && canvasBlank(); t++) await new Promise(r => setTimeout(r, 50));
    booth.shots.push(snapshot());
    flash();
    await new Promise(r => setTimeout(r, 700));
  }
  $("boothCount").hidden = true;
  openBooth();
}
const boothDate = () => new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
function drawBooth() {
  const out = renderBooth(booth.shots, booth.layout.id, booth.theme, $("boothCaption").value.trim(), boothDate(), booth.size);
  const cv = $("boothCanvas");
  cv.width = out.width; cv.height = out.height;
  cv.getContext("2d").drawImage(out, 0, 0);
  booth.result = out;
}
function openBooth() {
  $("booth").hidden = false;
  if (booth.theme.id === "custom") booth.theme = customThemeNow();
  drawBooth();
  renderCustomPanel();
  // theme swatches: tiny live renders of each frame (+ the Custom one)
  $("boothThemes").innerHTML = "";
  for (const t of [...THEMES, customThemeNow()]) {
    const b = document.createElement("button");
    b.title = t.name;
    b.classList.toggle("active", t.id === booth.theme.id);
    const mini = renderBooth(booth.shots, booth.layout.id, t, "", "", booth.size);
    const th = document.createElement("canvas");
    th.width = 120; th.height = 120;
    const k = Math.min(120 / mini.width, 120 / mini.height); // whole print, centred
    th.getContext("2d").drawImage(mini, (120 - mini.width * k) / 2, (120 - mini.height * k) / 2, mini.width * k, mini.height * k);
    b.append(th, Object.assign(document.createElement("span"), { textContent: t.name }));
    b.onclick = () => { booth.theme = t; openBooth(); };
    $("boothThemes").append(b);
  }
  $("boothSizes").innerHTML = "";
  for (const z of SIZES) {
    const b = document.createElement("button");
    b.innerHTML = `${z.name}<small>${z.note}</small>`;
    b.classList.toggle("active", z === booth.size);
    b.onclick = () => { booth.size = z; openBooth(); };
    $("boothSizes").append(b);
  }
  // Strip/Grid only applies to the Classic size
  const oneLayout = booth.shots.length === 1 || !!booth.size.w; // fixed paper sizes arrange photos themselves
  $("boothLayouts").hidden = oneLayout;
  $("boothLayoutLabel").hidden = oneLayout;
  $("boothLayouts").innerHTML = "";
  for (const l of LAYOUTS) {
    const b = Object.assign(document.createElement("button"), { textContent: l.name });
    b.classList.toggle("active", l === booth.layout);
    b.onclick = () => { booth.layout = l; openBooth(); };
    $("boothLayouts").append(b);
  }
}
function renderCustomPanel() {
  $("customPanel").hidden = booth.theme.id !== "custom";
  if ($("customPanel").hidden) return;
  $("customColors").innerHTML = CUSTOM_COLORS.map(c => `<button data-c="${c}" style="background:${c}" class="${c === custom.bg ? "active" : ""}" aria-label="Background ${c}"></button>`).join("");
  $("customColor").value = custom.bg;
  $("customFlowers").innerHTML = BOUQUETS.map(b => `<button data-id="${b.id}" class="${custom.flowers.includes(b.id) ? "active" : ""}" title="${b.name}"><img src="${b.src}" alt="${b.name}"></button>`).join("");
  $("customPetals").checked = custom.petals;
}
const refreshCustom = () => { booth.theme = customThemeNow(); openBooth(); };
$("customColors").onclick = e => { const b = e.target.closest("button"); if (b) { custom.bg = b.dataset.c; refreshCustom(); } };
$("customColor").oninput = e => { custom.bg = e.target.value; booth.theme = customThemeNow(); drawBooth(); };
$("customColor").onchange = refreshCustom;
$("customFlowers").onclick = e => {
  const b = e.target.closest("button"); if (!b) return;
  const id = b.dataset.id, i = custom.flowers.indexOf(id);
  if (i >= 0) custom.flowers.splice(i, 1);
  else if (custom.flowers.length < 4) custom.flowers.push(id);
  else return toast("Pick up to 4 bouquets");
  refreshCustom();
};
$("customPetals").onchange = e => { custom.petals = e.target.checked; refreshCustom(); };
$("boothCaption").oninput = drawBooth;
$("boothClose").onclick = () => ($("booth").hidden = true);
$("boothRetake").onclick = () => { $("booth").hidden = true; $("shutter").click(); };
$("boothSave").onclick = () => { booth.result.toBlob(b => download(b, "png"), "image/png"); toast("Print saved 🌸"); };

function takePhoto() {
  const f = $("flash");
  f.classList.remove("go"); void f.offsetWidth; f.classList.add("go");
  canvas.toBlob(blob => download(blob, "png"), "image/png");
  toast("Photo saved 🌸");
}
function startRecording() {
  const stream = canvas.captureStream(30);
  if ($("recordMusic").checked) musicStream().getAudioTracks().forEach(t => stream.addTrack(t));
  const type = ["video/mp4;codecs=avc1", "video/webm;codecs=vp9,opus", "video/webm"].find(t => MediaRecorder.isTypeSupported(t));
  const rec = new MediaRecorder(stream, { mimeType: type });
  const chunks = [];
  rec.ondataavailable = e => e.data.size && chunks.push(e.data);
  rec.onstop = () => {
    download(new Blob(chunks, { type }), type.startsWith("video/mp4") ? "mp4" : "webm");
    toast("Video saved 🎬");
    fitCanvas();
  };
  rec.start();
  state.recorder = rec;
  const t0 = performance.now();
  state.recTick = setInterval(() => {
    const s = Math.floor((performance.now() - t0) / 1000);
    $("recTime").textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }, 250);
  $("recBadge").hidden = false;
  $("shutter").classList.add("recording");
  $("shutter").setAttribute("aria-label", "Stop recording");
}
function stopRecording() {
  state.recorder.stop();
  state.recorder = null;
  clearInterval(state.recTick);
  $("recTime").textContent = "0:00";
  $("recBadge").hidden = true;
  $("shutter").classList.remove("recording");
  $("shutter").setAttribute("aria-label", "Start recording");
}
function download(blob, ext) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `flower-fist-${Date.now()}.${ext}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ================= Music: turntable playing Spotify's 30-second previews =================
// The previews allow CORS, so they go through Web Audio and can be mixed straight into recordings.
const tracks = PLAYLIST.tracks;
const audio = new Audio();
audio.crossOrigin = "anonymous";
audio.preload = "none";
let music = { i: 0, playing: false }, seeking = false, audioCtx, audioOut;
const fmt = s => `${Math.floor(s / 60)}:${String(Math.floor(s) % 60).padStart(2, "0")}`;

function musicStream() {
  if (!audioCtx) {
    audioCtx = new AudioContext();
    const src = audioCtx.createMediaElementSource(audio);
    audioOut = audioCtx.createMediaStreamDestination();
    src.connect(audioCtx.destination); // speakers
    src.connect(audioOut);             // recordings
  }
  return audioOut.stream;
}
$("vinylLabel").src = PLAYLIST.cover;
$("tracklist").innerHTML = tracks.map((t, i) => `<li><button data-i="${i}"><small>${i + 1}</small>${t.title}</button></li>`).join("");
$("tracklist").onclick = e => { const b = e.target.closest("button"); if (b) loadTrack(+b.dataset.i, true); };
$("listBtn").onclick = () => ($("tracklist").hidden = !$("tracklist").hidden);

function showTrack() {
  const t = tracks[music.i];
  $("trackTitle").textContent = t.title;
  $("trackArtist").textContent = t.artist;
  $("openSpotify").href = "https://open.spotify.com/track/" + t.id;
  document.querySelectorAll("#tracklist button").forEach(b => b.classList.toggle("active", +b.dataset.i === music.i));
}
function showPlayback() {
  music.playing = !audio.paused;
  $("vinyl").classList.toggle("spin", music.playing);
  $("tonearm").classList.toggle("on", music.playing);
  $("playBtn").textContent = music.playing ? "❚❚" : "▶";
  $("playBtn").setAttribute("aria-label", music.playing ? "Pause" : "Play");
  $("trackPos").textContent = fmt(audio.currentTime || 0);
  $("trackDur").textContent = fmt(audio.duration || 30);
  if (!seeking) $("seek").value = audio.duration ? (1000 * audio.currentTime) / audio.duration : 0;
}
function loadTrack(i, play) {
  music.i = (i + tracks.length) % tracks.length;
  audio.src = tracks[music.i].preview;
  showTrack();
  if (play) playMusic();
}
function playMusic() {
  musicStream();
  audioCtx.resume();
  audio.play().catch(() => toast("Couldn't play this track."));
}
$("playBtn").onclick = () => (audio.paused ? playMusic() : audio.pause());
$("nextBtn").onclick = () => loadTrack(music.i + 1, true);
$("prevBtn").onclick = () => (audio.currentTime > 3 ? (audio.currentTime = 0) : loadTrack(music.i - 1, true));
$("seek").oninput = () => (seeking = true);
$("seek").onchange = e => { seeking = false; if (audio.duration) audio.currentTime = (+e.target.value / 1000) * audio.duration; };
for (const ev of ["play", "pause", "timeupdate", "loadedmetadata"]) audio.addEventListener(ev, showPlayback);
audio.addEventListener("ended", () => loadTrack(music.i + 1, true));
loadTrack(0, false);
showPlayback();

// ================= Decoration: drifting petals =================
const petals = document.querySelector(".petals");
for (let i = 0; i < 10; i++) {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const size = 10 + Math.random() * 14;
  s.setAttribute("width", size); s.setAttribute("height", size);
  s.innerHTML = `<use href="#petal"/>`;
  s.style.left = Math.random() * 100 + "vw";
  s.style.animationDuration = 16 + Math.random() * 14 + "s";
  s.style.animationDelay = -Math.random() * 30 + "s";
  s.style.setProperty("--drift", (Math.random() * 30 - 15) + "vw");
  s.style.setProperty("--spin", Math.random() * 720 - 360 + "deg");
  if (i % 3 === 0) s.style.color = "var(--kraft)";
  petals.append(s);
}

let toastTimer;
function toast(msg) {
  const el = $("toast");
  el.textContent = msg; el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 2600);
}
