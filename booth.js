// Photo booth: composes 4 shots into a printed strip or grid with a floral frame.
// Decorations reuse the real bouquet photos, tucked into the frame's corners and edges.

export const SHOT_COUNTS = [1, 2, 3, 4];

// print sizes: "classic" grows to fit the photos; the rest are fixed canvases (300 dpi for the photo-paper ones)
export const SIZES = [
  { id: "classic", name: "Classic", note: "auto" },
  { id: "strip", name: "Strip", note: "2×6 in", w: 600, h: 1800, cols: 1 },
  { id: "4r", name: "4R", note: "4×6 in", w: 1200, h: 1800 },
  { id: "4r-land", name: "4R wide", note: "6×4 in", w: 1800, h: 1200 },
  { id: "square", name: "Square", note: "1:1 post", w: 1500, h: 1500 },
  { id: "story", name: "Story", note: "9:16", w: 1080, h: 1920 },
];

export const LAYOUTS = [
  { id: "strip", name: "Strip" },
  { id: "grid", name: "Grid" },
];

export const THEMES = [
  { id: "plain", name: "Plain", bg: "#FFFFFF", ink: "#3F2A20", accent: "#9C7653", petals: [], flowers: [] },
  { id: "tulip", name: "Tulip Cream", bg: "#F7EFE4", ink: "#4A3226", accent: "#D46A8A", petals: ["#F2C4D0", "#FFFFFF", "#DCE5C4"], flowers: ["tulip-putih", "tulip-pink", "tulip-pink-besar"] },
  { id: "rose", name: "Rose Romance", bg: "#F6D9DE", ink: "#6E0E1F", accent: "#B3122A", petals: ["#C0172F", "#F2A9B5", "#FFFFFF"], flowers: ["mawar-merah", "mawar-merah-tiga"] },
  { id: "sunflower", name: "Sunflower Summer", bg: "#FFF3CF", ink: "#5C3F0E", accent: "#D99A12", petals: ["#F7C531", "#FFE7A0", "#9DB86A"], flowers: ["matahari", "matahari-liar"] },
  { id: "peony", name: "Peony Blush", bg: "#FBE7EA", ink: "#5A2B3A", accent: "#C24D7A", petals: ["#F2D3D6", "#D22F6B", "#FFFFFF"], flowers: ["peony-blush", "peony-putih", "peony-magenta"] },
  { id: "daisy", name: "Daisy Meadow", bg: "#EEF3E2", ink: "#3E5530", accent: "#6F8F45", petals: ["#FFFFFF", "#F4D35E", "#C9D9A8"], flowers: ["daisy"] },
  { id: "kraft", name: "Kraft Classic", bg: "#D9BE9C", ink: "#3F2A20", accent: "#7A5236", petals: ["#F7EFE4", "#C9A27E", "#B4506F"], flowers: ["tulip-putih", "peony-blush", "mawar-merah"] },
  { id: "night", name: "Night Garden", bg: "#2B211B", ink: "#F7EFE4", accent: "#E9B7C4", petals: ["#F7EFE4", "#E9B7C4", "#8FA67A"], flowers: ["tulip-putih-besar", "peony-putih", "daisy"] },
];

const imgCache = {};
export function preloadFlowers(ids) {
  for (const id of ids) if (!imgCache[id]) imgCache[id] = Object.assign(new Image(), { src: `assets/flowers/${id}.png` });
}

// "Custom" frame: your own background colour, bouquets (max 4) and petals on/off.
// Text colours are picked automatically for contrast.
export function customTheme(bg, flowers, petals) {
  const n = parseInt(bg.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  const dark = 0.299 * r + 0.587 * g + 0.114 * b < 140;
  return {
    id: "custom", name: "Custom", bg, flowers,
    ink: dark ? "#FFF8EF" : "#3F2A20", accent: dark ? "#F2C4D0" : "#B4506F",
    petals: petals ? (dark ? ["#FFF8EF", "#F2C4D0", "#C9D9A8"] : ["#FFFFFF", "#F2C4D0", "#C9A27E"]) : [],
  };
}

// seeded random so a theme always decorates the same way
function rng(seed) { let s = seed; return () => ((s = (s * 16807) % 2147483647) / 2147483647); }

function drawCover(c, img, x, y, w, h) {
  const k = Math.max(w / img.width, h / img.height);
  const sw = w / k, sh = h / k;
  c.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, x, y, w, h);
}

function petal(c, x, y, r, rot, color) {
  c.save();
  c.translate(x, y); c.rotate(rot);
  c.fillStyle = color;
  c.beginPath();
  c.moveTo(0, -r);
  c.bezierCurveTo(r * 0.9, -r * 0.5, r * 0.9, r * 0.6, 0, r);
  c.bezierCurveTo(-r * 0.9, r * 0.6, -r * 0.9, -r * 0.5, 0, -r);
  c.fill();
  c.restore();
}

function flower(c, id, x, y, h, rot) {
  const img = imgCache[id];
  if (!img?.complete || !img.naturalWidth) return;
  const w = h * img.width / img.height;
  c.save();
  c.translate(x, y); c.rotate(rot);
  c.shadowColor = "rgba(0,0,0,.18)"; c.shadowBlur = h * 0.04; c.shadowOffsetY = h * 0.02;
  c.drawImage(img, -w / 2, -h / 2, w, h);
  c.restore();
}

// shots: canvases (4:3). Returns a new canvas with the finished print.
export function renderBooth(shots, layoutId, theme, caption, date, size = SIZES[0]) {
  // strip = one column; grid = 2×2 for 3–4 shots, otherwise one row; a single shot is a polaroid
  const n = shots.length;
  let strip = n > 1 && layoutId === "strip";
  let W, H, cols, m, gap, foot, pw, ph, offX = 0, offY = 0, capY = null, k;
  if (!size.w) {
    W = n === 1 ? 760 : strip ? 640 : 1100;
    m = strip ? 56 : 64; gap = strip ? 22 : 24; foot = strip ? 210 : 190;
    cols = strip ? 1 : n >= 3 ? 2 : n;
    pw = (W - 2 * m - (cols - 1) * gap) / cols; ph = pw * 3 / 4;
    H = m + Math.ceil(n / cols) * ph + (Math.ceil(n / cols) - 1) * gap + foot;
  } else {
    // fixed paper: photos stay whole (4:3, never cropped). Try every column count and keep the
    // arrangement that gives the biggest photos, then centre that block in the space above the caption.
    W = size.w; H = size.h;
    const u = Math.min(W, H);
    m = u * 0.085; gap = u * 0.035; foot = Math.max(H * 0.15, u * 0.26);
    const aw = W - 2 * m, ah = H - m - foot;
    let best = 0;
    for (let c = 1; c <= n; c++) {
      const r = Math.ceil(n / c);
      const w = Math.min((aw - (c - 1) * gap) / c, ((ah - (r - 1) * gap) / r) * 4 / 3);
      if (w > best) { best = w; cols = c; }
    }
    if (size.cols === 1) { cols = 1; best = Math.min((aw), (ah - (n - 1) * gap) / n * 4 / 3); }
    strip = cols === 1 && n > 1;
    pw = best; ph = best * 3 / 4;
    const r = Math.ceil(n / cols), bw = cols * pw + (cols - 1) * gap, bh = r * ph + (r - 1) * gap;
    // photos + caption are centred together, so no big empty band appears between them
    const capH = u * 0.22;
    offX = (W - bw) / 2 - m; offY = Math.max(0, (H - 2 * m - bh - capH) / 2);
    capY = m + offY + bh + capH / 2 + gap * 0.4;
    k = u / 700; // text and decorations follow the paper's short side
  }
  k = k || W / (strip ? 640 : 1100); // scale decorations and text with the paper

  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const c = cv.getContext("2d");
  const rand = rng(theme.id.split("").reduce((a, ch) => a + ch.charCodeAt(0), 7) * 97);

  // paper
  c.fillStyle = theme.bg; c.fillRect(0, 0, W, H);
  c.globalAlpha = 0.06; c.fillStyle = theme.ink;
  for (let i = 0; i < W * H / 180; i++) c.fillRect(rand() * W, rand() * H, 1.2, 1.2);
  c.globalAlpha = 1;

  // petals in the margins
  for (let i = 0; theme.petals.length && i < (strip ? 38 : 46); i++) {
    const x = rand() * W, y = rand() * H;
    petal(c, x, y, (5 + rand() * 9) * k, rand() * 6.28, theme.petals[i % theme.petals.length]);
  }

  // photos with a thin paper edge
  shots.forEach((shot, i) => {
    const lastAlone = i === n - 1 && n % cols === 1 && cols > 1; // centre a lone last shot (3 in a grid)
    const x = lastAlone ? (W - pw) / 2 : m + offX + (i % cols) * (pw + gap), y = m + offY + Math.floor(i / cols) * (ph + gap);
    c.fillStyle = "rgba(255,255,255,.9)";
    const e = 5 * k;
    c.fillRect(x - e, y - e, pw + 2 * e, ph + 2 * e);
    drawCover(c, shot, x, y, pw, ph);
  });

  // bouquets tucked into the corners and sides, partly off the paper
  const f = theme.flowers, s = (strip ? 1 : 1.25) * k;
  const spots = strip
    // top corners hang from the edge, blooms pointing down into the corner (small, so faces stay clear);
    // positions are [x, y in px from the top or as a fraction, height, rotation]
    ? [[0.05, -18, 150, Math.PI - 0.5], [0.95, -18, 150, Math.PI + 0.5], [0.02, 0.5, 220, -0.3], [0.98, 0.5, 220, 0.3], [0.1, 0.92, 330, -0.35], [0.9, 0.93, 320, 0.35]]
    : [[0.03, -14, 150, Math.PI - 0.55], [0.97, -14, 150, Math.PI + 0.55], [0.04, 0.9, 360, -0.4], [0.96, 0.88, 360, 0.4]];
  if (f.length) spots.forEach(([fx, fy, h, rot], i) => flower(c, f[i % f.length], fx * W, fy < 1 && fy > 0 ? fy * H : fy * k + h * s * 0.32, h * s, rot));

  // caption
  const cy = capY ?? H - foot / 2;
  c.textAlign = "center"; c.fillStyle = theme.ink;
  c.font = `italic 700 ${(strip ? 44 : 52) * k}px Fraunces, Georgia, serif`;
  c.fillText(caption || "Flower Fist", W / 2, cy + (strip ? 6 : 4) * k);
  c.font = `600 ${(strip ? 17 : 19) * k}px "Plus Jakarta Sans", system-ui, sans-serif`;
  c.fillStyle = theme.accent;
  c.fillText(date, W / 2, cy + (strip ? 42 : 44) * k);
  return cv;
}
