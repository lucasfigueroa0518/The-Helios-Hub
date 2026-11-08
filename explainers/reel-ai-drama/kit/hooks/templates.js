// The eight hooks, drawn. Each is draw(c, t, plan, R): a pure function of t onto one 1080×1920 canvas, so a seek lands the same
// whatever came before and nothing can flicker from leftover DOM state. Times and crops come from plan.js; offscreen canvases
// are caches of what doesn't change. No SVG filters (they show through hidden frames): the CRT's colour split and the tray's
// ripple are drawn. Each hook's look holds until the frame ends.

import { BURN_FRAMES, CAPTION_BAND, H, PLATES, SCREENS, W, clamp, coverCrop, fullFrameLook, logoGround, screenTreatments } from './plan.js';

const pr = (t, a, b) => (b <= a ? (t >= b ? 1 : 0) : clamp((t - a) / (b - a)));
const eo = (x) => 1 - Math.pow(1 - x, 3);
const ei = (x) => x * x * x;
const rnd = (s) => { const v = Math.sin(s * 127.1 + 11.7) * 43758.5453; return v - Math.floor(v); };
const frameOf = (t) => Math.floor(t * 30);
/** The last item whose `t` has come, by index; 0 before the first. */
const indexAt = (list, t, key = 't') => { let k = 0; list.forEach((x, i) => { if (t >= x[key]) k = i; }); return k; };
const ORANGE = '#ff6a1a';

// ── Shared drawing ──────────────────────────────────────────────────────────────────────────────

function blit(c, im, crop, x, y, w, h) {
  const iw = im.naturalWidth || im.width;
  const ih = im.naturalHeight || im.height;
  c.drawImage(im, crop.x * iw, crop.y * ih, crop.w * iw, crop.h * ih, x, y, w, h);
}

/** A picture whole inside a box, on nothing. */
function contain(c, im, x, y, w, h) {
  const iw = im.naturalWidth || im.width;
  const ih = im.naturalHeight || im.height;
  const k = Math.min(w / iw, h / ih);
  c.drawImage(im, x + (w - iw * k) / 2, y + (h - ih * k) / 2, iw * k, ih * k);
}

/** A soft, dim copy of a picture to stand a print on. */
function backdrop(c, R, id) {
  const cached = R.cached(`back-${id}`, 270, 480, (g) => {
    const m = R.media[id];
    g.filter = 'blur(3.5px) brightness(.42) saturate(.8)';
    blit(g, R.img(id), coverCrop(m, 270, 480), -8, -14, 286, 508);
    g.filter = 'none';
  });
  c.imageSmoothingQuality = 'high';
  c.drawImage(cached, 0, 0, W, H);
}

/** A picture as a white-bordered print, centred under the captions, its subject kept in. */
function printAt(c, R, id, { width = 740, cx = W / 2, cy = 940, rot = -0.03, scale = 1, filter = 'none' } = {}) {
  const m = R.media[id];
  const a = Math.min(1.4, Math.max(0.72, (m.width || 1) / (m.height || 1)));
  const w = width * scale;
  const h = Math.min(w / a, 1000);
  const crop = coverCrop(m, w, h, { place: [0.5, 0.42] });
  const B = 28 * scale;
  c.save();
  c.translate(cx, cy);
  c.rotate(rot);
  c.shadowColor = 'rgba(0,0,0,.65)';
  c.shadowBlur = 70;
  c.shadowOffsetY = 34;
  c.fillStyle = '#f4f1ea';
  c.fillRect(-w / 2 - B, -h / 2 - B, w + 2 * B, h + B * 3.2);
  c.shadowColor = 'transparent';
  c.filter = filter;
  blit(c, R.img(id), crop, -w / 2, -h / 2, w, h);
  c.filter = 'none';
  c.restore();
}

/** A picture holding the whole frame the way it can: full-bleed, a print over a backdrop, or a mark on its ground. */
function fullFrame(c, R, id, { zoom = 1, filter = 'none', under = null, rot = -0.03 } = {}) {
  const m = R.media[id];
  const look = fullFrameLook(m);
  if (look === 'cover') {
    c.filter = filter;
    blit(c, R.img(id), coverCrop(m, W, H, { zoom }), 0, 0, W, H);
    c.filter = 'none';
    return;
  }
  if (look === 'logo') {
    c.fillStyle = logoGround(m);
    c.fillRect(0, 0, W, H);
    const size = 720 * zoom;
    contain(c, R.img(id), (W - size) / 2, 900 - size / 2, size, size);
    return;
  }
  backdrop(c, R, under ?? id);
  printAt(c, R, id, { scale: zoom, rot, filter });
}

/** Thin dark rows across a region: the screen a hook is seen through. */
function scanlines(c, R, alpha, period, x = 0, y = 0, w = W, h = H) {
  const name = `scan-${period}`;
  const tile = R.cached(name, 4, period, (g) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, 4, Math.round(period / 2));
  });
  c.save();
  c.globalAlpha = alpha;
  c.fillStyle = c.createPattern(tile, 'repeat');
  c.fillRect(x, y, w, h);
  c.restore();
}

/** The CRT: colour split, rows, a rolling band, grain and a dark bezel, over a finished scene. */
function crt(c, R, scene, t, { jitter = 0, noise = 0.09 } = {}) {
  const fr = frameOf(t);
  const part = (name, colour) => {
    const o = R.canvas(name);
    const g = o.getContext('2d');
    g.globalCompositeOperation = 'source-over';
    g.drawImage(scene, 0, 0);
    g.globalCompositeOperation = 'multiply';
    g.fillStyle = colour;
    g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'source-over';
    return o;
  };
  const r = part('crt-r', '#f00');
  const gr = part('crt-g', '#0f0');
  const b = part('crt-b', '#00f');
  c.fillStyle = '#000';
  c.fillRect(0, 0, W, H);
  c.save();
  c.globalCompositeOperation = 'lighter';
  c.drawImage(r, jitter + 6, 0);
  c.drawImage(gr, jitter, 0);
  c.drawImage(b, jitter - 6, 0);
  c.restore();
  scanlines(c, R, 0.34, 6);
  const by = ((fr * 38) % 2300) - 200;
  const band = c.createLinearGradient(0, by, 0, by + 240);
  band.addColorStop(0, 'rgba(255,255,255,0)');
  band.addColorStop(0.5, 'rgba(255,255,255,.1)');
  band.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = band;
  c.fillRect(0, by, W, 240);
  c.save();
  c.globalAlpha = noise;
  c.globalCompositeOperation = 'screen';
  c.imageSmoothingEnabled = false;
  c.drawImage(R.plate(`noise${fr % 4}`), 0, 0, W, H);
  c.restore();
  const v = c.createRadialGradient(W / 2, H / 2, H * 0.34, W / 2, H / 2, H * 0.66);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,.92)');
  c.fillStyle = v;
  c.fillRect(0, 0, W, H);
  c.save();
  c.strokeStyle = '#000';
  c.lineWidth = 90;
  c.beginPath();
  c.roundRect(-5, -5, W + 10, H + 10, 130);
  c.stroke();
  c.restore();
}

// ── Flashbulb ───────────────────────────────────────────────────────────────────────────────────

function flashbulb(c, t, P, R) {
  const k = indexAt(P.shots, t);
  const s = P.shots[k];
  const d = Math.max(0, t - s.t);
  const frozen = k === P.freeze;
  const lit = [...P.shots.slice(1).map((x) => [x.t, 1]), ...P.later.map((x) => [x, 0.5])];
  let flash = 0;
  let bloom = 0;
  for (const [at, power] of lit) {
    if (t < at) continue;
    flash = Math.max(flash, power * Math.exp(-(t - at) / 0.06));
    bloom = Math.max(bloom, power * Math.exp(-(t - at) / 0.09));
  }
  const zoom = frozen ? 1.02 + 0.04 * pr(t, s.t, P.duration) : 1.12 - 0.1 * eo(pr(d, 0, 0.25));
  const dx = frozen ? 0 : (rnd(k) - 0.5) * 50;
  const dy = frozen ? 0 : (rnd(k + 9) - 0.5) * 40;
  c.fillStyle = '#000';
  c.fillRect(0, 0, W, H);
  c.save();
  c.translate(W / 2 + dx, H / 2 + dy);
  c.scale(zoom, zoom);
  c.translate(-W / 2, -H / 2);
  fullFrame(c, R, s.asset, { filter: frozen ? `grayscale(1) contrast(1.3) brightness(${1 + 1.6 * bloom})` : `brightness(${1 + 2.2 * bloom})` });
  c.restore();
  if (flash > 0.004) {
    c.fillStyle = `rgba(255,255,255,${clamp(flash)})`;
    c.fillRect(0, 0, W, H);
  }
}

// ── Wall of Screens ─────────────────────────────────────────────────────────────────────────────

function drawCell(c, R, q, cell, i, t, kill) {
  const x = q[0] * W - 1;
  const y = q[1] * H - 1;
  const w = q[2] * W + 2;
  const h = q[3] * H + 2;
  const fr = frameOf(t);
  if (t >= kill + 0.16) {
    c.fillStyle = '#060706';
    c.fillRect(x, y, w, h);
    c.fillStyle = '#242424';
    c.beginPath();
    c.arc(x + w / 2, y + h / 2, 1.6, 0, 7);
    c.fill();
    return;
  }
  if (t >= kill) {
    c.save();
    c.imageSmoothingEnabled = false;
    c.drawImage(R.plate(`noise${(fr + i) % 4}`), x, y, w, h);
    c.restore();
    return;
  }
  const m = R.media[cell.asset];
  const ways = screenTreatments(m);
  const way = cell.big ? { ...ways[1], zoom: Math.min(ways[1].zoom, 1.7) } : ways[cell.way];
  c.fillStyle = m.kind === 'logo' ? logoGround(m) : '#1a1a1a';
  c.fillRect(x, y, w, h);
  if (m.kind === 'logo' && way.zoom === 1) contain(c, R.img(cell.asset), x + w * 0.1, y + h * 0.1, w * 0.8, h * 0.8);
  else blit(c, R.img(cell.asset), coverCrop(m, w, h, { zoom: way.zoom, at: way.at, place: [0.5, 0.5] }), x, y, w, h);
  c.fillStyle = `rgba(0,0,0,${0.06 + 0.05 * Math.sin(t * 4.2 + i * 1.7)})`;
  c.fillRect(x, y, w, h);
}

/** What the CRT shows once we're inside: the picture we entered, then each one on its word, the second of a pair set below the first. */
function insideScene(s, t, P, R) {
  s.fillStyle = '#000';
  s.fillRect(0, 0, W, H);
  const first = P.inside[0];
  if (t < first.t) {
    fullFrame(s, R, P.entered, { zoom: 1.05 + 0.1 * pr(t, P.tIn, first.t) });
    return;
  }
  const k = indexAt(P.inside, t);
  const mainAt = k - (k % 2);
  const main = P.inside[mainAt];
  const inset = k % 2 ? P.inside[k] : null;
  const m = R.media[main.asset];
  const kick = 1 + 0.25 * Math.exp(-(t - main.t) / 0.06);
  const insetIn = inset ? eo(pr(t, inset.t, inset.t + 0.35)) : 0;
  if (fullFrameLook(m) === 'logo') {
    const size = (700 - 140 * insetIn) * kick * (1 + 0.04 * pr(t, main.t, main.t + 2));
    const cy = 880 - 90 * insetIn;
    if (logoGround(m) !== '#0b0b0b') {
      s.fillStyle = logoGround(m);
      s.fillRect(0, 0, W, H);
    }
    contain(s, R.img(main.asset), (W - size) / 2, cy - size / 2, size, size);
  } else {
    fullFrame(s, R, main.asset, { zoom: (1.02 + 0.06 * pr(t, main.t, main.t + 2.4)) * Math.min(kick, 1.12) });
  }
  if (inset) {
    const im = R.media[inset.asset];
    const w = 480 * (0.72 + 0.28 * insetIn);
    const h = w * 0.5625;
    const x = (W - w) / 2;
    const y = 1270 - h / 2;
    s.save();
    s.globalAlpha = eo(pr(t, inset.t, inset.t + 0.15));
    s.fillStyle = im.kind === 'logo' ? logoGround(im) : '#111';
    s.beginPath();
    s.roundRect(x, y, w, h, 14);
    s.fill();
    s.clip();
    if (im.kind === 'logo') contain(s, R.img(inset.asset), x + 20, y + 14, w - 40, h - 28);
    else blit(s, R.img(inset.asset), coverCrop(im, w, h), x, y, w, h);
    s.restore();
    s.save();
    s.strokeStyle = 'rgba(255,255,255,.35)';
    s.lineWidth = 3;
    s.beginPath();
    s.roundRect(x, y, w, h, 14);
    s.stroke();
    s.restore();
  }
}

function wallOfScreens(c, t, P, R) {
  const fr = frameOf(t);
  if (t < P.tIn) {
    const q = SCREENS[P.big];
    const cx = (q[0] + q[2] / 2) * W;
    const cy = (q[1] + q[3] / 2) * H;
    const fill = Math.max(1 / q[2], 1 / q[3]) * 1.06;
    let Z = 1 + 0.2 * pr(t, 0, P.tEnter);
    if (t >= P.tEnter) Z = 1.2 + (fill - 1.2) * ei(pr(t, P.tEnter, P.tEnter + 0.55));
    const pull = pr(Z, 1, 1.2);
    const ax = W / 2 + (cx - W / 2) * pull;
    const ay = H / 2 + (cy - H / 2) * pull;
    c.fillStyle = '#000';
    c.fillRect(0, 0, W, H);
    c.save();
    c.setTransform(Z, 0, 0, Z, W / 2 - ax * Z, H / 2 - ay * Z);
    SCREENS.forEach((sq, i) => drawCell(c, R, sq, P.cells[i], i, t, i === P.big ? Infinity : P.kills[i]));
    scanlines(c, R, 0.28, 4);
    c.drawImage(R.plate(PLATES.screens.key), 0, 0, W, H);
    c.restore();
    return;
  }
  const scene = R.canvas('scene');
  const s = scene.getContext('2d');
  insideScene(s, t, P, R);
  const change = P.inside.some((x) => Math.abs(t - x.t) < 0.12);
  const jitter = (rnd(fr) - 0.5) * (change ? 70 : 5);
  const burst = (t < P.inside[0].t && t < P.tIn + 0.1 + 0.25) || P.inside.some((x) => Math.abs(t - x.t) < 0.06);
  crt(c, R, scene, t, { jitter, noise: burst ? 0.9 : 0.09 });
  if (burst) {
    // Static is bright: the captions keep their ground through it.
    c.fillStyle = 'rgba(0,0,0,.72)';
    c.fillRect(0, CAPTION_BAND.top - 20, W, CAPTION_BAND.bottom - CAPTION_BAND.top + 40);
  }
}

// ── Lock-On ─────────────────────────────────────────────────────────────────────────────────────

const LOGO_BOX = { x: 0.13, y: 0.27, w: 0.74, h: 0.42 };

function lockOn(c, t, P, R) {
  const S = P.targets[indexAt(P.targets, t, 'start')];
  const s = indexAt(S.steps, t);
  const step = S.steps[s];
  const d = Math.max(0, t - step.t);
  const locked = t >= S.lock;
  const last = S === P.targets[P.targets.length - 1];
  const drift = locked && last ? 1 + 0.05 * pr(t, S.lock, P.duration) : 1;
  let src;
  let crop;
  let box = S.box;
  if (S.logo) {
    const m = R.media[S.asset];
    src = R.cached(`logo-${S.asset}`, W, H, (g) => {
      g.fillStyle = logoGround(m);
      g.fillRect(0, 0, W, H);
      contain(g, R.img(S.asset), W * 0.15, H * 0.27, W * 0.7, H * 0.42);
    });
    box = LOGO_BOX;
    crop = coverCrop({ width: W, height: H }, W, H, { zoom: (1 / step.h) * drift, at: [0.5, 0.48], place: [0.5, 0.48] });
  } else {
    const m = R.media[S.asset];
    src = R.img(S.asset);
    const whole = coverCrop(m, W, H);
    const z = Math.max(1, whole.h / step.h) * drift;
    crop = coverCrop(m, W, H, { zoom: z, at: [S.box.x + S.box.w / 2, S.box.y + S.box.h / 2], place: [0.5, 0.48] });
  }
  // The de-res after each step: blocks that resolve in a quarter second.
  const B = [72, 48, 28, 16, 8, 1];
  const blk = B[Math.min(5, Math.floor(d / 0.05))];
  const low = R.canvas('low');
  const lw = Math.max(2, Math.ceil(W / blk));
  const lh = Math.max(2, Math.ceil(H / blk));
  low.width = lw;
  low.height = lh;
  const lg = low.getContext('2d');
  lg.imageSmoothingQuality = 'high';
  blit(lg, src, crop, 0, 0, lw, lh);
  c.save();
  c.imageSmoothingEnabled = blk <= 1;
  c.imageSmoothingQuality = 'high';
  const stamped = P.stamp && t >= P.stamp.t && t < P.stamp.until;
  c.filter = stamped ? 'brightness(.42)' : locked ? 'none' : 'grayscale(.85) contrast(1.15) brightness(.9)';
  c.drawImage(low, 0, 0, W, H);
  c.filter = 'none';
  c.restore();
  scanlines(c, R, 0.12, 4);

  if (stamped) {
    const k = 1 + 0.5 * Math.exp(-(t - P.stamp.t) / 0.05);
    c.save();
    c.translate(W / 2, 1270);
    c.scale(k, k);
    let size = 108;
    c.font = `700 ${size}px "Pragmatica Extended", sans-serif`;
    const tw = c.measureText(P.stamp.text).width;
    if (tw > 940) size *= 940 / tw;
    c.font = `700 ${size}px "Pragmatica Extended", sans-serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = ORANGE;
    c.fillText(P.stamp.text, 0, 0);
    c.restore();
    return;
  }

  const pulse = P.pulses.reduce((a, at) => (t >= at ? Math.max(a, Math.exp(-(t - at) / 0.14)) : a), 0);
  const L = ((box.x - crop.x) / crop.w) * W - 30;
  const T = ((box.y - crop.y) / crop.h) * H - 30;
  const BW = (box.w / crop.w) * W + 60;
  const BH = (box.h / crop.h) * H + 60;
  const grow = 26 * pulse;
  const x0 = L - grow;
  const y0 = T - grow;
  const x1 = L + BW + grow;
  const y1 = T + BH + grow;
  const arm = 70;
  c.save();
  c.strokeStyle = locked ? ORANGE : '#fff';
  c.lineWidth = 6;
  for (const [x, y, sx, sy] of [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]]) {
    c.beginPath();
    c.moveTo(x + sx * arm, y);
    c.lineTo(x, y);
    c.lineTo(x, y + sy * arm);
    c.stroke();
  }
  c.restore();
}

// ── Rewind ──────────────────────────────────────────────────────────────────────────────────────

function triangles(c, x, y, size, dir, count) {
  c.fillStyle = '#fff';
  for (let i = 0; i < count; i++) {
    const ox = x + i * size * 0.95;
    c.beginPath();
    c.moveTo(ox + (dir > 0 ? 0 : size), y);
    c.lineTo(ox + (dir > 0 ? size : 0), y + size / 2);
    c.lineTo(ox + (dir > 0 ? 0 : size), y + size);
    c.closePath();
    c.fill();
  }
}

function rewind(c, t, P, R) {
  const fr = frameOf(t);
  const scene = R.canvas('scene');
  const o = scene.getContext('2d');
  const rew = t < P.land;
  o.fillStyle = '#000';
  o.fillRect(0, 0, W, H);
  if (rew) {
    const list = P.rew.length ? P.rew : [{ asset: P.shots[0].asset, t: 0 }];
    fullFrame(o, R, list[indexAt(list, t)].asset, { zoom: 1.04, filter: 'saturate(1.6) contrast(1.1)' });
  } else {
    const k = indexAt(P.shots, t);
    const s = P.shots[k];
    fullFrame(o, R, s.asset, { zoom: 1.02 + 0.06 * pr(t, s.t, P.shots[k + 1]?.t ?? P.duration), under: P.shots[Math.max(0, k - 1)].asset });
  }
  const ff = P.ff && t >= P.ff.from && t < P.ff.to;
  const cut = [...P.cuts, ...P.glitches].some((x) => t >= x && t < x + 0.12);
  const heavy = rew || ff;
  c.fillStyle = '#000';
  c.fillRect(0, 0, W, H);
  const bh = heavy || cut ? 24 : 40;
  const roll = (fr * (heavy ? 170 : 30)) % H;
  for (let y = 0; y < H; y += bh) {
    const n = rnd(y * 0.13 + fr);
    const inBand = Math.abs(((y - roll + H) % H) - 260) < (heavy ? 230 : 60) ? 1 : 0;
    const dx = (n - 0.5) * (heavy || cut ? (inBand ? 300 : 30) : (inBand ? 46 : 4));
    c.drawImage(scene, 0, y, W, bh, dx, y, W, bh);
  }
  c.fillStyle = `rgba(255,255,255,${heavy ? 0.09 : 0.05})`;
  for (let y = 0; y < H; y += 6) c.fillRect(0, y, W, 2);
  const by = (fr * (heavy ? 97 : 21)) % H;
  c.fillStyle = `rgba(255,255,255,${heavy ? 0.55 : 0.22})`;
  for (let i = 0; i < (heavy ? 70 : 14); i++) c.fillRect(rnd(i + fr) * W, by + rnd(i * 3) * 50, 40 + rnd(i) * 160, 3);

  // The tape's counter: below the captions, where a deck's readout sits.
  const year = rew && P.topYear != null ? Math.round(P.topYear + (P.landYear - P.topYear) * Math.pow(pr(t, 0, P.land), 0.75)) : P.landYear;
  c.save();
  c.textBaseline = 'alphabetic';
  if (rew) {
    triangles(c, 72, 1330, 62, -1, 2);
    if (year != null) {
      c.font = '700 170px "Pragmatica Extended", sans-serif';
      c.shadowOffsetY = 0;
      c.fillStyle = '#f03';
      c.fillText(String(year), 75, 1560);
      c.fillStyle = '#0af';
      c.fillText(String(year), 65, 1560);
      c.fillStyle = '#fff';
      c.fillText(String(year), 70, 1560);
    }
  } else {
    c.fillStyle = 'rgba(0,0,0,.55)';
    c.beginPath();
    c.roundRect(50, 1486, ff ? 340 : 292, 92, 10);
    c.fill();
    triangles(c, 72, 1505, 50, 1, ff ? 2 : 1);
    if (year != null) {
      c.font = '700 64px "Pragmatica Extended", sans-serif';
      c.fillStyle = '#fff';
      c.fillText(String(year), ff ? 196 : 148, 1554);
    }
  }
  c.restore();
}

// ── Darkroom ────────────────────────────────────────────────────────────────────────────────────

const PAPER = '#efe9df';
/** The picture's window on the print: a real print's border, and a face never larger than this share of it. */
const WINDOW = { x: 50, y: 146, w: 663, h: 690 };
const FACE_MAX = 0.6;

/** The developed picture on a print: bordered, and smaller when the photo is close, so a face is never right up against the viewer. */
function developed(R, id, w, h) {
  return R.cached(`print-${id}`, w, h, (g) => {
    const m = R.media[id];
    let win = { ...WINDOW };
    let crop = coverCrop(m, win.w, win.h, { place: [0.5, 0.42] });
    if (m.face) {
      const share = m.face.h / crop.h;
      if (share > FACE_MAX) {
        const k = Math.max(0.62, FACE_MAX / share);
        win = { w: win.w * k, h: win.h * k, x: win.x + (win.w * (1 - k)) / 2, y: win.y + (win.h * (1 - k)) / 2 };
        crop = coverCrop(m, win.w, win.h, { place: [0.5, 0.42] });
      }
    }
    g.fillStyle = '#cfcfcf';
    g.fillRect(win.x, win.y, win.w, win.h);
    g.filter = 'grayscale(1) contrast(1.35)';
    blit(g, R.img(id), crop, win.x, win.y, win.w, win.h);
    g.filter = 'none';
  });
}

function darkroom(c, t, P, R) {
  const [qx, qy, qw, qh] = PLATES.darkroom.tray;
  const L = qx * W;
  const T = qy * H;
  const w = Math.round(qw * W);
  const h = Math.round(qh * H);
  const paper = R.canvas('paper', w, h);
  const g = paper.getContext('2d');
  g.fillStyle = PAPER;
  g.fillRect(0, 0, w, h);
  const k = indexAt(P.prints, t);
  P.prints.forEach((p, i) => {
    if (i > k) return;
    const slide = i === 0 ? 0 : (1 - eo(pr(t, p.t, p.t + 0.23))) * 800;
    g.fillStyle = PAPER;
    g.fillRect(slide, 0, w, h);
    g.save();
    g.globalAlpha = Math.pow(pr(t, p.from, p.to), i === 0 ? 1.5 : 0.8);
    g.drawImage(developed(R, p.asset, w, h), slide, 0);
    g.restore();
  });

  // The tray's water over the print: rows pushed side to side, more while it's still developing or just agitated.
  const dev = pr(t, P.prints[0].from, P.done);
  const rock = [...P.agitations, ...P.after].reduce((a, at) => (t >= at ? Math.max(a, Math.exp(-(t - at) / 0.45)) : a), 0);
  const amp = 3 + 4 * (1 - dev) + 6 * rock;
  const tray = R.canvas('tray', w, h);
  const tg = tray.getContext('2d');
  tg.fillStyle = '#2a0705';
  tg.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += 6) {
    const dx = amp * Math.sin(y * 0.021 + t * 2.7) + amp * 0.55 * Math.sin(y * 0.0073 - t * 1.6);
    tg.drawImage(paper, 0, y, w, 6, dx, y, w, 6);
  }
  const flashes = [P.done, ...P.prints.slice(1).map((p) => p.to)];
  const lift = flashes.reduce((a, at) => (t >= at ? Math.max(a, 0.55 * Math.exp(-(t - at) / 0.25)) : a), 0);
  tg.save();
  tg.globalCompositeOperation = 'multiply';
  tg.globalAlpha = 1 - lift;
  tg.fillStyle = '#e02a22';
  tg.fillRect(0, 0, w, h);
  tg.restore();

  const cx = L + w / 2;
  const cy = T + h / 2;
  const bump = t >= P.done ? 0.05 * Math.exp(-(t - P.done) / 0.12) : 0;
  const Z = 1 + 0.28 * pr(t, 0, P.duration) + bump;
  c.fillStyle = '#000';
  c.fillRect(0, 0, W, H);
  c.save();
  c.setTransform(Z, 0, 0, Z, W / 2 - cx * Z, H / 2 + 40 - cy * Z);
  c.drawImage(tray, L - 1, T - 1, w + 2, h + 2);
  c.drawImage(R.plate(PLATES.darkroom.key), 0, 0, W, H);
  c.restore();
}

// ── Slide Carousel ──────────────────────────────────────────────────────────────────────────────

/** The projector sits this far down so the wall and the whole slide show under the captions. */
const SLIDE_DROP = 300;

function slideCarousel(c, t, P, R) {
  const [qx, qy, qw, qh] = PLATES.projector.screen;
  const L = qx * W;
  const T = qy * H;
  const w = qw * W;
  const h = qh * H;
  const tl = eo(pr(t, P.pullFrom, P.pullTo));
  const after = pr(t, P.pullTo, P.duration);
  const Z = 2.3 + (1 - 2.3) * tl + 0.06 * after;
  const cy = 1500 + (H / 2 - SLIDE_DROP - 1500) * tl - 30 * after;
  c.fillStyle = '#000';
  c.fillRect(0, 0, W, H);
  c.save();
  c.setTransform(Z, 0, 0, Z, W / 2 - (W / 2) * Z, H / 2 - cy * Z);
  // The wall carries on above the plate.
  const plate = R.plate(PLATES.projector.key);
  c.drawImage(plate, 0, 0, plate.naturalWidth, 2, 0, -SLIDE_DROP - 400, W, SLIDE_DROP + 402);

  c.save();
  c.beginPath();
  c.rect(L - 1, T - 1, w + 2, h + 2);
  c.clip();
  c.fillStyle = '#070605';
  c.fillRect(L - 1, T - 1, w + 2, h + 2);
  const on = P.slides.findIndex((s) => t >= s.t) >= 0;
  if (on) {
    const k = indexAt(P.slides, t);
    const s = P.slides[k];
    const d = t - s.t;
    if (d >= 0.07) {
      const m = R.media[s.asset];
      const sx = Math.exp(-d / 0.08) * 22 * (k % 2 ? 1 : -1);
      const sy = -Math.exp(-d / 0.08) * 14;
      const blur = Math.max(0, 9 * (1 - d / 0.2));
      const look = `blur(${blur}px) brightness(${1.1 + 0.3 * Math.exp(-d / 0.15)}) contrast(1.05) saturate(.92)`;
      if (fullFrameLook(m) === 'logo') {
        c.fillStyle = logoGround(m);
        c.fillRect(L, T, w, h);
        c.filter = look;
        contain(c, R.img(s.asset), L + w * 0.14 + sx, T + h * 0.12 + sy, w * 0.72, h * 0.76);
      } else {
        c.filter = look;
        const crop = coverCrop(m, w, h, { zoom: 1.03, place: [0.5, 0.42] });
        blit(c, R.img(s.asset), crop, L + sx, T + sy, w, h);
      }
      c.filter = 'none';
    }
  }
  const glow = c.createRadialGradient(L + w / 2, T + h * 0.52, 40, L + w / 2, T + h * 0.52, Math.max(w, h) * 0.75);
  glow.addColorStop(0, 'rgba(255,240,210,.07)');
  glow.addColorStop(1, 'rgba(0,0,0,.5)');
  c.fillStyle = glow;
  c.fillRect(L - 1, T - 1, w + 2, h + 2);
  c.restore();
  c.drawImage(plate, 0, 0, W, H);
  c.restore();
}

// ── Front Page ──────────────────────────────────────────────────────────────────────────────────

/** The page sits this far down: captions run over the press above it, and the headline and photo are whole below them. */
const PAGE_DROP = CAPTION_BAND.bottom + 24;

/** The largest type that sets a headline inside its box, in lines. */
function setHeadline(g, text, x, y, w, h) {
  const words = String(text).split(/\s+/);
  for (let size = 92; size >= 30; size -= 2) {
    g.font = `700 ${size}px Tinos, Georgia, serif`;
    const lines = [];
    let line = '';
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (g.measureText(next).width > w - 28 && line) { lines.push(line); line = word; } else line = next;
    }
    if (line) lines.push(line);
    const lead = size * 1.06;
    if (lines.length * lead <= h - 8 && lines.every((l) => g.measureText(l).width <= w - 28)) {
      g.fillStyle = '#141210';
      g.textBaseline = 'top';
      lines.forEach((l, i) => g.fillText(l, x + 14, y + 4 + i * lead));
      return;
    }
  }
}

/** One whole article: paper, headline, photo in place. Made once; a page lands whole. */
function pageCanvas(R, p, i) {
  const { headline: hq, photo: pq, key } = PLATES.frontpage;
  return R.cached(`page-${i}`, W, H, (g) => {
    g.fillStyle = '#e7e3d8';
    g.fillRect(0, 0, W, H);
    setHeadline(g, p.headline, hq[0] * W, hq[1] * H, hq[2] * W, hq[3] * H);
    const x = pq[0] * W - 1;
    const y = pq[1] * H - 1;
    const w = pq[2] * W + 2;
    const h = pq[3] * H + 2;
    const m = R.media[p.asset];
    g.save();
    g.beginPath();
    g.rect(x, y, w, h);
    g.clip();
    g.fillStyle = m.kind === 'logo' ? logoGround(m) : '#111';
    g.fillRect(x, y, w, h);
    if (m.kind === 'logo') {
      g.filter = 'contrast(1.15)';
      contain(g, R.img(p.asset), x + w * 0.2, y + h * 0.06, w * 0.6, h * 0.88);
    } else {
      g.filter = 'grayscale(1) contrast(1.3)';
      blit(g, R.img(p.asset), coverCrop(m, w, h, { place: [0.5, 0.42] }), x, y, w, h);
      g.filter = 'none';
      // Newsprint's halftone over a photo.
      const dot = R.cached('halftone', 8, 8, (d) => {
        d.fillStyle = '#000';
        d.beginPath();
        d.arc(4, 4, 2.1, 0, 7);
        d.fill();
      });
      g.globalAlpha = 0.5;
      g.globalCompositeOperation = 'multiply';
      g.fillStyle = g.createPattern(dot, 'repeat');
      g.fillRect(x, y, w, h);
    }
    g.restore();
    g.drawImage(R.plate(key), 0, 0, W, H);
  });
}

function frontPage(c, t, P, R) {
  const fr = frameOf(t);
  const press = R.plate('press');
  const first = P.pages[0];
  const running = 1 - pr(t, first.land, first.land + 0.3);
  c.fillStyle = '#000';
  c.fillRect(0, 0, W, H);
  if (running > 0) {
    c.save();
    const z = 1.15 + 0.25 * pr(t, 0, first.land);
    c.translate(W / 2 + (rnd(fr) - 0.5) * 22, H / 2 + (rnd(fr + 3) - 0.5) * 32);
    c.scale(z, z);
    c.translate(-W / 2, -H / 2);
    c.filter = 'blur(1.5px)';
    c.drawImage(press, 0, 0, W, H);
    c.filter = 'none';
    c.restore();
  }
  // Once a page is down the press stays behind it, still and dark, under the captions.
  c.save();
  c.globalAlpha = 1 - running;
  const still = R.cached('press-dim', 270, 480, (g) => {
    g.filter = 'blur(2.5px) brightness(.3)';
    g.drawImage(press, -8, -8, 286, 496);
    g.filter = 'none';
  });
  c.drawImage(still, 0, 0, W, H);
  c.restore();

  // Each page settles at its own angle and offset, a little lower than the one under it, so the pile shows the
  // edges and headlines of the pages beneath (Lucas, 2026-11-07).
  const pose = (i) => {
    const n = P.pages.length;
    const sign = i % 2 ? 1 : -1;
    return { x: sign * (44 + 22 * (i % 3)), y: i * 118 - (n - 1) * 50, rot: sign * (5.5 + 2 * ((i * 7) % 3)) * (Math.PI / 180) };
  };
  const land = (i) => {
    const p = P.pages[i];
    const o = pose(i);
    const Z = 0.84 + 0.02 * eo(pr(t, P.pushes[i], P.pushes[i] + 0.4)) + 0.015 * pr(t, p.land, P.pages[i + 1]?.spin ?? P.duration);
    const shake = Math.exp(-Math.max(0, t - p.land) / 0.05) * 0.035;
    const k = Z + shake;
    c.save();
    c.translate(W / 2 + o.x, PAGE_DROP + o.y);
    c.rotate(o.rot);
    c.scale(k, k);
    c.translate(-W / 2, 0);
    c.shadowColor = 'rgba(0,0,0,.75)';
    c.shadowBlur = 34;
    c.shadowOffsetY = 6;
    c.drawImage(pageCanvas(R, p, i), 0, 0);
    c.restore();
  };
  P.pages.forEach((p, i) => {
    if (t >= p.land) land(i);
    else if (t >= p.spin) {
      const q0 = pr(t, p.spin, p.land);
      const q = eo(q0);
      const o = pose(i);
      const s = 0.04 + 0.82 * q;
      c.save();
      c.translate(W / 2 + o.x * q, PAGE_DROP + o.y + (1 - q) * 520);
      c.rotate((1 - q) * 6 * Math.PI + o.rot);
      c.scale(s, s);
      c.translate(-W / 2, 0);
      c.shadowColor = 'rgba(0,0,0,.8)';
      c.shadowBlur = 60;
      c.shadowOffsetY = 30;
      c.drawImage(pageCanvas(R, p, i), 0, 0);
      c.restore();
    }
  });
}

// ── Burn ────────────────────────────────────────────────────────────────────────────────────────

function burnLayer(g, R, P, i, t) {
  g.fillStyle = '#000';
  g.fillRect(0, 0, W, H);
  const from = i === 0 ? 0 : P.burns[i - 1].t;
  const to = P.burns[i] ? P.burns[i].t + P.burns[i].d : P.duration;
  fullFrame(g, R, P.shots[i], { zoom: 1.06 + 0.1 * pr(t, from, to), under: P.shots[Math.max(0, i - 1)] });
}

function burn(c, t, P, R) {
  let k = 0;
  P.burns.forEach((b) => { if (t >= b.t + b.d) k++; });
  const b = P.burns[k];
  const on = b && t >= b.t;
  burnLayer(c, R, P, on ? k + 1 : k, t);
  if (!on) return;
  const p = pr(t, b.t, b.t + b.d);
  const n = Math.round(Math.pow(p, 0.85) * (BURN_FRAMES - 1));
  const top = R.canvas('burn-top');
  const y = top.getContext('2d');
  y.globalCompositeOperation = 'source-over';
  burnLayer(y, R, P, k, t);
  y.globalCompositeOperation = 'destination-in';
  y.save();
  y.translate(W / 2, H / 2);
  y.scale(b.flipX, b.flipY);
  y.drawImage(R.burnMask(n), -W / 2, -H / 2, W, H);
  y.restore();
  y.globalCompositeOperation = 'source-over';
  c.drawImage(top, 0, 0);
  c.save();
  c.globalCompositeOperation = 'screen';
  c.translate(W / 2, H / 2);
  c.scale(b.flipX, b.flipY);
  c.drawImage(R.burnFire(n), -W / 2, -H / 2, W, H);
  c.restore();
}

export const TEMPLATES = { flashbulb, wall_of_screens: wallOfScreens, lock_on: lockOn, rewind, darkroom, slide_carousel: slideCarousel, front_page: frontPage, burn };

/** The plate images each hook needs loaded before it draws. */
export const PLATES_NEEDED = {
  flashbulb: [],
  wall_of_screens: [PLATES.screens.key, 'noise0', 'noise1', 'noise2', 'noise3'],
  lock_on: [],
  rewind: [],
  darkroom: [PLATES.darkroom.key],
  slide_carousel: [PLATES.projector.key],
  front_page: [PLATES.frontpage.key, 'press'],
  burn: [],
};
