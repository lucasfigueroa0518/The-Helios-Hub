/**
 * Where each slot of each approved template sits (BUILD_PLAN M2), measured on
 * the images by eye against a 10% grid on 2026-10-13. Boxes are 0–1 of the
 * image. A slot's text or label is drawn inside its box and shrinks to fit;
 * nothing is drawn outside it.
 *
 * `style`: `outline` is white text with a dark edge, for photos and art;
 * `dark` is black text, for white or pale panels; `plate` is black text on a
 * white plate that fills the box, for a format whose own use pastes over a
 * printed word (Friendship Ended's two names). A plate covers only printed
 * text, never a figure.
 *
 * Cards 26–60 were measured on their images on 2026-10-14, against a 5% grid
 * and a 1% grid where a box must sit inside a bubble or over a printed word.
 *
 * `faces` adds the faces the MediaPipe detector missed (cartoon faces, a
 * turned head) to the ones it found (faces.generated.ts). No box may touch a
 * face (ME-12), and the test and the render check both hold to it.
 */
export type Box = { x: number; y: number; w: number; h: number };
export type SlotStyle = 'outline' | 'dark' | 'plate';
export type SlotBox = Box & { style: SlotStyle };
export type TemplateGeometry = { slots: Record<string, SlotBox>; faces?: Box[] };

const o = (x: number, y: number, w: number, h: number): SlotBox => ({ x, y, w, h, style: 'outline' });
const d = (x: number, y: number, w: number, h: number): SlotBox => ({ x, y, w, h, style: 'dark' });
const p = (x: number, y: number, w: number, h: number): SlotBox => ({ x, y, w, h, style: 'plate' });
const f = (x: number, y: number, w: number, h: number): Box => ({ x, y, w, h });

export const TEMPLATE_GEOMETRY: Readonly<Record<string, TemplateGeometry>> = {
  drake: { slots: { rejected: d(0.52, 0.05, 0.45, 0.4), preferred: d(0.52, 0.55, 0.45, 0.4) } },
  'two-buttons': {
    slots: { 'left-button': d(0.08, 0.115, 0.3, 0.085), 'right-button': d(0.42, 0.055, 0.3, 0.08), chooser: o(0.25, 0.86, 0.55, 0.12) },
  },
  'distracted-boyfriend': {
    slots: { 'new-thing': o(0.12, 0.62, 0.3, 0.16), tempted: o(0.47, 0.48, 0.26, 0.16), 'current-thing': o(0.76, 0.55, 0.22, 0.16) },
    faces: [f(0.76, 0.27, 0.1, 0.2)],
  },
  'uno-draw-25': { slots: { 'obvious-thing': d(0.13, 0.3, 0.31, 0.19), refuser: o(0.55, 0.56, 0.42, 0.12) } },
  'left-exit-12': { slots: { 'sensible-way': o(0.24, 0.13, 0.15, 0.19), 'tempting-exit': o(0.52, 0.13, 0.21, 0.19), swerver: o(0.3, 0.66, 0.42, 0.14) } },
  'anakin-padme': { slots: { speaker: o(0.02, 0.01, 0.46, 0.1), announcement: o(0.02, 0.38, 0.46, 0.11), hope: o(0.51, 0.005, 0.48, 0.11), doubt: o(0.51, 0.53, 0.48, 0.085) } },
  'epic-handshake': { slots: { 'left-arm': o(0.02, 0.3, 0.28, 0.14), 'right-arm': o(0.66, 0.38, 0.32, 0.14), clasp: o(0.25, 0.02, 0.5, 0.12) } },
  'grus-plan': {
    slots: {
      'step-1': d(0.29, 0.08, 0.19, 0.37), 'step-2': d(0.8, 0.08, 0.17, 0.37),
      flaw: d(0.29, 0.58, 0.19, 0.36), 'flaw-again': d(0.8, 0.58, 0.17, 0.36),
    },
    faces: [f(0.1, 0.5, 0.15, 0.2), f(0.62, 0.5, 0.16, 0.18)],
  },
  'running-away-balloon': {
    slots: {
      wanter: o(0.01, 0.38, 0.3, 0.09), want: d(0.62, 0.08, 0.34, 0.26), holder: d(0.01, 0.76, 0.27, 0.14),
      'wanter-again': o(0.32, 0.82, 0.22, 0.1), 'want-again': d(0.77, 0.55, 0.22, 0.18),
    },
    faces: [f(0.08, 0.6, 0.17, 0.12), f(0.37, 0.62, 0.16, 0.11)],
  },
  'disaster-girl': { slots: { mess: o(0.02, 0.05, 0.55, 0.22), culprit: o(0.6, 0.3, 0.38, 0.15) } },
  'waiting-skeleton': { slots: { wait: o(0.02, 0.005, 0.96, 0.1), still: o(0.02, 0.88, 0.96, 0.11) }, faces: [f(0.38, 0.11, 0.25, 0.19)] },
  'x-everywhere': { slots: { thing: o(0.03, 0.02, 0.94, 0.14), everywhere: o(0.03, 0.84, 0.94, 0.14), noticer: o(0.16, 0.62, 0.2, 0.12) }, faces: [f(0.45, 0.28, 0.12, 0.14)] },
  'trade-offer': { slots: { 'i-receive': o(0.03, 0.215, 0.45, 0.13), 'you-receive': o(0.53, 0.215, 0.45, 0.13), offerer: o(0.02, 0.78, 0.3, 0.12) } },
  'woman-yelling-at-cat': { slots: { complaint: d(0.01, 0.01, 0.48, 0.18), reply: d(0.51, 0.01, 0.48, 0.18) }, faces: [f(0.69, 0.45, 0.17, 0.13)] },
  'marked-safe-from': { slots: { who: d(0.03, 0.1, 0.36, 0.24), dodged: d(0.05, 0.49, 0.9, 0.2) } },
  'ancient-aliens': { slots: { setup: o(0.02, 0.01, 0.96, 0.16), explanation: o(0.02, 0.84, 0.78, 0.15) } },
  'bike-fall': {
    slots: { goal: d(0.53, 0.05, 0.41, 0.16), rider: d(0.53, 0.24, 0.4, 0.12), 'self-move': d(0.07, 0.42, 0.36, 0.15), outcome: d(0.5, 0.71, 0.42, 0.1) },
    faces: [f(0.34, 0.06, 0.06, 0.04), f(0.5, 0.43, 0.06, 0.06), f(0.7, 0.82, 0.07, 0.06)],
  },
  'mocking-spongebob': { slots: { claim: o(0.02, 0.01, 0.96, 0.18), mocked: o(0.02, 0.83, 0.96, 0.16) }, faces: [f(0.22, 0.25, 0.43, 0.55)] },
  'is-this-a-pigeon': { slots: { mislabeler: o(0.02, 0.74, 0.28, 0.11), thing: o(0.66, 0.33, 0.32, 0.1), question: o(0.05, 0.88, 0.9, 0.11) } },
  'you-guys-getting-paid': { slots: { setup: o(0.02, 0.01, 0.96, 0.18), reveal: o(0.02, 0.8, 0.96, 0.19) } },
  'one-does-not-simply': { slots: { opener: o(0.02, 0.01, 0.96, 0.2), 'hard-thing': o(0.02, 0.78, 0.96, 0.21) } },
  'buff-doge-cheems': {
    slots: { strong: d(0.0, 0.01, 0.45, 0.1), 'strong-caption': d(0.0, 0.74, 0.47, 0.25), weak: d(0.55, 0.02, 0.45, 0.12), 'weak-caption': d(0.53, 0.74, 0.47, 0.25) },
    faces: [f(0.2, 0.12, 0.1, 0.11), f(0.74, 0.22, 0.12, 0.14)],
  },
  'same-picture': { slots: { 'left-picture': d(0.06, 0.07, 0.38, 0.24), 'right-picture': d(0.52, 0.12, 0.4, 0.25), pam: o(0.4, 0.8, 0.36, 0.1) } },
  'zero-days-without': { slots: { event: d(0.55, 0.26, 0.43, 0.24), culprit: o(0.4, 0.8, 0.58, 0.17) }, faces: [f(0.33, 0.28, 0.19, 0.27)] },
  'squidward-window': { slots: { watcher: o(0.02, 0.3, 0.3, 0.12), enjoyers: o(0.5, 0.56, 0.46, 0.14) }, faces: [f(0.52, 0.3, 0.14, 0.12), f(0.67, 0.18, 0.13, 0.1)] },
  // ── Cards 26–60 ──
  'expanding-brain': {
    slots: { 'take-1': d(0.01, 0.01, 0.475, 0.23), 'take-2': d(0.01, 0.265, 0.475, 0.225), 'take-3': d(0.01, 0.52, 0.475, 0.205), 'take-4': d(0.01, 0.755, 0.475, 0.235) },
    faces: [f(0.55, 0.0, 0.4, 0.24), f(0.55, 0.26, 0.42, 0.24), f(0.55, 0.51, 0.42, 0.22), f(0.55, 0.75, 0.42, 0.25)],
  },
  trophy: {
    slots: { missing: o(0.37, 0.0, 0.62, 0.235), punch: o(0.02, 0.51, 0.96, 0.12), speaker: o(0.01, 0.67, 0.35, 0.11) },
    faces: [f(0.02, 0.08, 0.33, 0.33), f(0.38, 0.64, 0.4, 0.23)],
  },
  'absolute-cinema': { slots: { absolute: o(0.0, 0.29, 0.38, 0.14), 'cinema-word': o(0.63, 0.29, 0.37, 0.14), cinema: o(0.03, 0.74, 0.94, 0.25) } },
  'oprah-you-get-a': {
    slots: { 'you-get': o(0.01, 0.0, 0.48, 0.19), 'you-get-again': o(0.51, 0.0, 0.48, 0.19), giver: o(0.34, 0.55, 0.34, 0.14), gift: o(0.02, 0.76, 0.96, 0.23) },
  },
  'tuxedo-pooh': { slots: { casual: d(0.46, 0.01, 0.53, 0.48), fancy: d(0.46, 0.52, 0.53, 0.47) }, faces: [f(0.05, 0.0, 0.39, 0.42), f(0.05, 0.52, 0.39, 0.4)] },
  'megamind-peeking': { slots: { asker: o(0.02, 0.0, 0.96, 0.11), missing: o(0.02, 0.11, 0.96, 0.15) }, faces: [f(0.12, 0.27, 0.62, 0.73)] },
  'pawn-stars': { slots: { ask: o(0.02, 0.0, 0.96, 0.11), lowballer: o(0.02, 0.5, 0.38, 0.18), offer: o(0.02, 0.76, 0.96, 0.23) } },
  'this-is-fine': { slots: { fire: o(0.01, 0.01, 0.47, 0.28), sitter: o(0.01, 0.76, 0.47, 0.23) }, faces: [f(0.14, 0.31, 0.2, 0.3), f(0.52, 0.28, 0.36, 0.6)] },
  'thinking-about': { slots: { worry: o(0.0, 0.56, 0.46, 0.43), thinker: o(0.44, 0.33, 0.2, 0.15), thought: o(0.48, 0.62, 0.51, 0.37) } },
  'bell-curve': {
    slots: { simple: d(0.0, 0.3, 0.36, 0.29), overthought: d(0.02, 0.005, 0.96, 0.115), expert: d(0.64, 0.2, 0.36, 0.31) },
    faces: [f(0.06, 0.6, 0.2, 0.22), f(0.41, 0.13, 0.21, 0.27), f(0.76, 0.53, 0.15, 0.28)],
  },
  'they-dont-know': {
    slots: { secret: d(0.32, 0.0, 0.67, 0.21), knower: d(0.31, 0.3, 0.26, 0.17), crowd: o(0.58, 0.52, 0.25, 0.13) },
    faces: [f(0.16, 0.08, 0.14, 0.14), f(0.64, 0.25, 0.12, 0.17), f(0.83, 0.36, 0.13, 0.11), f(0.22, 0.68, 0.13, 0.13), f(0.05, 0.63, 0.11, 0.1)],
  },
  'two-guys-bus': { slots: { topic: o(0.22, 0.02, 0.5, 0.12), stuck: o(0.01, 0.33, 0.29, 0.18), view: o(0.66, 0.27, 0.33, 0.17) }, faces: [f(0.14, 0.54, 0.11, 0.14), f(0.64, 0.47, 0.11, 0.14)] },
  'imagination-spongebob': {
    slots: { dull: o(0.02, 0.0, 0.96, 0.22), imagined: o(0.02, 0.82, 0.96, 0.175), pitcher: o(0.0, 0.64, 0.27, 0.17) },
    faces: [f(0.28, 0.28, 0.44, 0.53)],
  },
  // The looker's logo sits on the puppet that looks away (its red hair, right panel), not above the picture (Lucas, 2026-10-19).
  'monkey-puppet': { slots: { fact: d(0.01, 0.005, 0.98, 0.32), looker: o(0.52, 0.41, 0.26, 0.11) }, faces: [f(0.2, 0.55, 0.28, 0.32), f(0.68, 0.57, 0.3, 0.3)] },
  'clown-makeup': {
    slots: {
      clown: d(0.02, 0.005, 0.42, 0.07), 'step-1': d(0.02, 0.08, 0.56, 0.165), 'step-2': d(0.02, 0.265, 0.56, 0.22),
      'step-3': d(0.02, 0.515, 0.52, 0.22), 'step-4': d(0.02, 0.765, 0.56, 0.225),
    },
    faces: [f(0.64, 0.55, 0.22, 0.2), f(0.67, 0.8, 0.22, 0.2)],
  },
  'roll-safe': { slots: { premise: o(0.45, 0.02, 0.54, 0.29), twist: o(0.45, 0.33, 0.4, 0.29), dodger: o(0.3, 0.8, 0.34, 0.17) } },
  'friendship-ended': {
    slots: { ended: p(0.665, 0.0, 0.3, 0.145), 'new-friend': p(0.37, 0.255, 0.245, 0.14), speaker: o(0.23, 0.86, 0.36, 0.13) },
    faces: [f(0.1, 0.6, 0.07, 0.08), f(0.8, 0.62, 0.09, 0.09)],
  },
  'hide-the-pain': { slots: { setup: d(0.0, 0.0, 0.57, 0.2), pain: d(0.0, 0.5, 0.57, 0.2), smiler: o(0.6, 0.84, 0.39, 0.1) }, faces: [f(0.58, 0.53, 0.2, 0.18)] },
  'spiderman-triple': {
    slots: { left: o(0.0, 0.54, 0.37, 0.12), middle: o(0.32, 0.0, 0.42, 0.105), right: o(0.62, 0.38, 0.38, 0.12), caption: o(0.3, 0.88, 0.36, 0.11) },
    faces: [f(0.18, 0.2, 0.08, 0.1), f(0.5, 0.11, 0.07, 0.1), f(0.72, 0.24, 0.09, 0.1)],
  },
  'where-monkey': { slots: { asker: o(0.02, 0.01, 0.96, 0.14), missing: o(0.02, 0.74, 0.96, 0.25) }, faces: [f(0.09, 0.2, 0.14, 0.2), f(0.29, 0.16, 0.15, 0.22), f(0.68, 0.2, 0.14, 0.2)] },
  boardroom: {
    slots: {
      boss: o(0.15, 0.212, 0.2, 0.055), question: d(0.315, 0.012, 0.58, 0.066),
      'idea-1': d(0.05, 0.381, 0.2, 0.041), 'idea-2': d(0.327, 0.394, 0.162, 0.038), rejected: d(0.628, 0.404, 0.245, 0.052),
    },
    faces: [f(0.15, 0.09, 0.14, 0.12), f(0.66, 0.11, 0.08, 0.08), f(0.88, 0.11, 0.09, 0.09), f(0.17, 0.46, 0.08, 0.07), f(0.43, 0.46, 0.08, 0.07), f(0.77, 0.48, 0.09, 0.07), f(0.09, 0.71, 0.2, 0.13), f(0.31, 0.84, 0.13, 0.11)],
  },
  'types-of-headaches': { slots: { worst: d(0.44, 0.575, 0.55, 0.13) } },
  // Each line sits on its own Kermit: the good side on the plain Kermit, the inner one on the hooded one (Lucas, 2026-10-19).
  'evil-kermit': {
    slots: { good: o(0.01, 0.79, 0.44, 0.2), inner: o(0.5, 0.77, 0.49, 0.22), kermit: o(0.0, 0.42, 0.26, 0.3) },
    faces: [f(0.13, 0.18, 0.31, 0.2), f(0.27, 0.18, 0.17, 0.6), f(0.52, 0.3, 0.25, 0.45)],
  },
  'three-headed-dragon': {
    slots: { set: o(0.01, 0.0, 0.98, 0.11), 'head-left': o(0.0, 0.65, 0.34, 0.12), 'head-middle': o(0.35, 0.7, 0.3, 0.12), 'head-right': o(0.66, 0.76, 0.33, 0.12) },
    faces: [f(0.05, 0.17, 0.3, 0.46), f(0.36, 0.12, 0.29, 0.44), f(0.68, 0.25, 0.28, 0.33)],
  },
  'flex-tape': { slots: { leak: o(0.6, 0.1, 0.39, 0.2), patch: o(0.02, 0.82, 0.96, 0.17), patcher: o(0.12, 0.17, 0.32, 0.12) }, faces: [f(0.26, 0.0, 0.12, 0.12)] },
  'all-my-homies-hate': { slots: { hated: o(0.02, 0.74, 0.96, 0.25) }, faces: [f(0.1, 0.05, 0.88, 0.27)] },
  'sleeping-shaq': { slots: { sleeper: d(0.03, 0.04, 0.44, 0.1), missed: d(0.03, 0.16, 0.44, 0.34), wakes: d(0.03, 0.58, 0.44, 0.38) }, faces: [f(0.5, 0.58, 0.45, 0.4)] },
  'laughing-leo': { slots: { claim: o(0.6, 0.01, 0.39, 0.46), laugher: o(0.28, 0.8, 0.42, 0.15) } },
  'bad-luck-brian': { slots: { setup: o(0.02, 0.01, 0.96, 0.17), outcome: o(0.02, 0.77, 0.96, 0.22), unlucky: o(0.02, 0.64, 0.32, 0.11) } },
  'something-of-a-scientist': { slots: { act: o(0.02, 0.02, 0.96, 0.2), claimer: o(0.02, 0.24, 0.3, 0.14), field: o(0.02, 0.74, 0.96, 0.25) } },
  'inhaling-seagull': {
    slots: { inhale: o(0.02, 0.005, 0.96, 0.08), build: o(0.02, 0.255, 0.96, 0.06), 'wind-up': o(0.02, 0.505, 0.96, 0.08), yell: o(0.02, 0.84, 0.96, 0.155), yeller: o(0.02, 0.755, 0.45, 0.075) },
    faces: [f(0.43, 0.09, 0.28, 0.035), f(0.6, 0.32, 0.2, 0.04), f(0.22, 0.59, 0.2, 0.08), f(0.5, 0.77, 0.27, 0.06)],
  },
  'scooby-mask': {
    slots: { disguise: o(0.0, 0.33, 0.37, 0.14), unmasked: o(0.0, 0.81, 0.4, 0.12), revealer: o(0.6, 0.85, 0.39, 0.1) },
    faces: [f(0.1, 0.12, 0.25, 0.2), f(0.13, 0.6, 0.2, 0.19), f(0.7, 0.06, 0.18, 0.17), f(0.72, 0.52, 0.18, 0.17)],
  },
  'no-yes': {
    slots: { no: d(0.41, 0.05, 0.55, 0.42), yes: d(0.41, 0.53, 0.55, 0.4), chooser: o(0.03, 0.82, 0.34, 0.11) },
    faces: [f(0.08, 0.03, 0.17, 0.2), f(0.2, 0.52, 0.14, 0.2)],
  },
  'panik-kalm-panik': {
    slots: { panik: d(0.035, 0.02, 0.415, 0.3), kalm: d(0.035, 0.36, 0.415, 0.3), 'panik-again': d(0.035, 0.695, 0.415, 0.29) },
    faces: [f(0.6, 0.02, 0.27, 0.28), f(0.6, 0.36, 0.25, 0.28), f(0.56, 0.7, 0.32, 0.28)],
  },
  'surprised-pikachu': { slots: { obvious: d(0.02, 0.01, 0.96, 0.38), surprised: o(0.0, 0.76, 0.245, 0.21) }, faces: [f(0.25, 0.62, 0.6, 0.32)] },
};

export const overlaps = (a: Box, b: Box): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
