// The kit's stylesheet: the news kit's (board, whiteboard, newspaper; ported from the approved
// ai-news-truecrime stills) plus Reel AI Drama's full-screen treatments (the approved
// reel-ai-drama-look stills, MD-42/MD-44: Helios type, paper-lit and orange on graded photos). Injected
// once per document by installKit(); fonts come from the job's assets/fonts (no CDN, no network at render).
//
// Determinism: no CSS animations or transitions anywhere; textures are baked tiles (kit/textures).

/** Helios tokens (explainers/frame-presets/helios/FRAME.md): the words, type and accent (MD-44). */
export const HELIOS = { orange: '#FF5E1A', paperLit: '#FEF9F3', paper: '#F4EFE7', ink: '#1F1915', night: '#0D0B0A' };

export const COLORS = {
  cord: '#B5241B',
  marker: '#E8431A', // Helios orange, the one key-detail accent on board and newspaper
  ink: '#1B1A17',
  paper: '#EFE7D6',
  manila: '#D9BE85',
  dry: { blue: '#1E3FAF', red: '#C3271B', black: '#141414' },
};

export const FONT_FILES = {
  pragmatica: 'PragmaticaExtended-Bold.otf',
  roboto400: 'Roboto-400.woff2',
  roboto500: 'Roboto-500.woff2',
  roboto700: 'Roboto-700.woff2',
  gochi: 'GochiHand-Regular.ttf',
  // Open-licence stand-ins for the stills' Mac faces (Didot, American Typewriter, Times New Roman), bundled
  // so the Linux render VM sets the same type as a Mac preview.
  playfair: 'PlayfairDisplay.ttf',
  courier: 'CourierPrime-Regular.ttf',
  tinos400: 'Tinos-Regular.ttf',
  tinos700: 'Tinos-Bold.ttf',
  tinosItalic: 'Tinos-Italic.ttf',
};

/** The baked surface tiles (kit/textures, made by bake-textures.mjs). No live element is ever given an
 *  SVG filter: HyperFrames composites those even while their frame is hidden. */
export const TEXTURE_FILES = ['cork.png', 'paper.png', 'grain.png', 'ink.png', 'dryerase.png'];
const TILE = '512px 512px';

export function fontFaces(fonts) {
  return `
@font-face{font-family:'Pragmatica Extended';src:url('${fonts.pragmatica}') format('opentype');font-weight:700;}
@font-face{font-family:'Roboto';src:url('${fonts.roboto400}') format('woff2');font-weight:400;}
@font-face{font-family:'Roboto';src:url('${fonts.roboto500}') format('woff2');font-weight:500;}
@font-face{font-family:'Roboto';src:url('${fonts.roboto700}') format('woff2');font-weight:700;}
@font-face{font-family:'Gochi Hand';src:url('${fonts.gochi}') format('truetype');}
@font-face{font-family:'Playfair Display';src:url('${fonts.playfair}') format('truetype');font-weight:400 900;}
@font-face{font-family:'Courier Prime';src:url('${fonts.courier}') format('truetype');font-weight:400;}
@font-face{font-family:'Tinos';src:url('${fonts.tinos400}') format('truetype');font-weight:400;}
@font-face{font-family:'Tinos';src:url('${fonts.tinos700}') format('truetype');font-weight:700;}
@font-face{font-family:'Tinos';src:url('${fonts.tinosItalic}') format('truetype');font-weight:400;font-style:italic;}`;
}

export const css = (tex) => `
.nk{--cord:${COLORS.cord};--marker:${COLORS.marker};--news-ink:${COLORS.ink};--paper:${COLORS.paper};--manila:${COLORS.manila};
  --serif:'Tinos','Times New Roman',serif;--head:'Playfair Display','Didot',serif;
  --type:'Courier Prime','American Typewriter',monospace;--hand:'Gochi Hand',cursive;
  position:absolute;left:0;top:0;width:1080px;height:1920px;overflow:hidden;background:#2a2118;-webkit-font-smoothing:antialiased;}
.nk *{box-sizing:border-box;}
.nk .abs{position:absolute;}
.nk-cam{position:absolute;inset:0;transform-origin:0 0;}
.nk-stage{position:absolute;inset:0;}
.nk-front{position:absolute;inset:0;pointer-events:none;z-index:40;}
.nk-grain{position:absolute;inset:0;pointer-events:none;opacity:0.22;mix-blend-mode:overlay;background:url('${tex}grain.png') 0 0/${TILE};z-index:50;}

/* Board: cork under a warm practical lamp, vignette */
.nk-cork{position:absolute;inset:-200px;background:#8E6136;}
.nk-cork::before{content:'';position:absolute;inset:0;background:url('${tex}cork.png') 0 0/${TILE};}
.nk-lamp{background:radial-gradient(48% 34% at 58% 46%,rgba(255,200,130,0.22) 0%,rgba(255,200,130,0) 72%),
  radial-gradient(105% 80% at 52% 48%,rgba(0,0,0,0) 38%,rgba(10,6,3,0.78) 100%);}
.nk-dof{filter:blur(5px) brightness(0.8);}

/* Whiteboard: a real board in a room */
.nk-room{position:absolute;inset:-200px;background:radial-gradient(90% 60% at 50% 40%,#5d5a55,#2b2926 80%);}
.nk-wb{position:absolute;border-radius:6px;
  background:linear-gradient(180deg,#F7F8F8 0%,#EEF0F0 55%,#E3E6E6 100%);
  box-shadow:0 0 0 14px #C4C8CB,0 0 0 16px #9EA3A7,0 0 0 18px #D7DADC,0 40px 60px -10px rgba(0,0,0,0.55);}
.nk-wb-skin{position:absolute;inset:0;border-radius:6px;overflow:hidden;pointer-events:none;}
.nk-wb-skin .nk-residue{position:absolute;inset:0;opacity:0.12;filter:blur(3px);}
.nk-wb-glare{position:absolute;inset:0;z-index:30;pointer-events:none;border-radius:6px;background:
  linear-gradient(105deg,rgba(255,255,255,0) 22%,rgba(255,255,255,0.55) 27%,rgba(255,255,255,0) 31%,rgba(255,255,255,0) 36%,rgba(255,255,255,0.4) 39%,rgba(255,255,255,0) 42%),
  radial-gradient(40% 18% at 78% 12%,rgba(255,255,255,0.7),rgba(255,255,255,0) 70%);mix-blend-mode:screen;}
.nk-wb-corner{position:absolute;width:34px;height:34px;background:#8B9095;border-radius:4px;box-shadow:inset 0 2px 2px rgba(255,255,255,0.4);z-index:3;}
.nk-wb-tray{position:absolute;height:46px;background:linear-gradient(180deg,#D0D4D7,#8F959A 60%,#B7BCC0);border-radius:0 0 8px 8px;box-shadow:0 14px 20px -8px rgba(0,0,0,0.5);}
.nk-wb-lamp{background:radial-gradient(110% 85% at 50% 45%,rgba(0,0,0,0) 50%,rgba(20,18,15,0.55) 100%);}

/* Newspaper: the page is the surface */
.nk-desk{position:absolute;inset:-200px;background:radial-gradient(80% 60% at 50% 40%,#5a4632,#2a1f15 85%);}
.nk-np{position:absolute;background:#E9E1CD;color:var(--news-ink);box-shadow:0 30px 60px -20px rgba(0,0,0,0.6);}
.nk-np::after{content:'';position:absolute;inset:0;pointer-events:none;background:url('${tex}paper.png') 0 0/${TILE};opacity:0.6;mix-blend-mode:multiply;}
.nk-np .nk-mast{font:700 112px/1 'Old English Text MT','Engravers MT',var(--head);text-align:center;letter-spacing:0.01em;white-space:nowrap;}
.nk-rule{border-top:3px solid var(--news-ink);border-bottom:1px solid var(--news-ink);height:5px;margin:14px 0;}
.nk-dateline{display:flex;justify-content:space-between;font:700 18px var(--serif);letter-spacing:0.14em;text-transform:uppercase;}
.nk-greek{height:10px;margin:10px 0;background:#4b463d;opacity:0.42;}
.nk-np-lamp{background:radial-gradient(105% 80% at 50% 45%,rgba(0,0,0,0) 48%,rgba(25,18,10,0.6) 100%);}
.nk-article .nk-hl{font:700 80px/0.98 var(--head);letter-spacing:-0.01em;}
.nk-article .nk-deck{font:italic 400 30px/1.2 var(--serif);margin:14px 0;color:#3A362F;}
.nk-article .nk-body{column-count:2;column-gap:26px;font:400 26px/1.32 var(--serif);text-align:justify;}

/* Paper evidence */
.nk-clip{position:absolute;background:var(--paper);color:var(--news-ink);box-shadow:0 2px 2px rgba(0,0,0,0.25),0 26px 40px -16px rgba(0,0,0,0.65);}
.nk-clip::after,.nk-paperish::after{content:'';position:absolute;inset:0;pointer-events:none;background:url('${tex}paper.png') 0 0/${TILE};opacity:0.55;mix-blend-mode:multiply;}
.nk-clip .nk-kicker{font:700 20px var(--serif);letter-spacing:0.16em;text-transform:uppercase;border-bottom:2px solid var(--news-ink);padding-bottom:8px;display:flex;justify-content:space-between;}
.nk-clip h1{font:700 84px/0.95 var(--head);letter-spacing:-0.01em;margin:18px 0 14px;}
.nk-clip h2{font:italic 400 32px/1.2 var(--serif);margin:0 0 16px;color:#3A362F;}
.nk-clip .nk-cols{column-count:2;column-gap:28px;font:400 26px/1.32 var(--serif);text-align:justify;hyphens:auto;color:#2A2823;}
.nk-clip .nk-cols p{margin:0 0 10px;}
.nk-halftone{position:relative;overflow:hidden;filter:grayscale(1) contrast(1.35) brightness(1.05);background:#bbb;}
.nk-halftone img{width:100%;height:100%;object-fit:cover;display:block;}
.nk-halftone::after{content:'';position:absolute;inset:0;background:radial-gradient(circle,rgba(0,0,0,0) 38%,var(--paper) 62%) 0 0/7px 7px;mix-blend-mode:screen;opacity:0.85;}
.nk-sheet{position:absolute;background:#F7F4EC;color:#1D1C19;box-shadow:0 30px 50px -20px rgba(0,0,0,0.7);}
.nk-index{position:absolute;background:#F6F1E4;color:#22201B;font:400 30px/1.45 var(--type);padding:34px 40px;box-shadow:0 20px 34px -14px rgba(0,0,0,0.65);
  background-image:linear-gradient(180deg,transparent 0 78px,rgba(200,60,60,0.55) 78px 80px,transparent 80px),repeating-linear-gradient(180deg,transparent 0 43px,rgba(80,120,190,0.28) 43px 44px);}
.nk-tag{position:absolute;padding:16px 24px 18px 46px;background:linear-gradient(180deg,#E7CF98,#D6B977);color:#2D2414;font:400 30px var(--type);letter-spacing:0.02em;white-space:nowrap;
  clip-path:polygon(28px 0,100% 0,100% 100%,28px 100%,0 50%);filter:drop-shadow(0 14px 12px rgba(0,0,0,0.45));transform-origin:20px 50%;}
.nk-tag::before{content:'';position:absolute;left:20px;top:50%;width:14px;height:14px;margin-top:-7px;border-radius:50%;background:#7A5A2C;box-shadow:inset 0 1px 2px rgba(0,0,0,0.6);}
.nk-polaroid{position:absolute;background:#F5F2EA;padding:22px 22px 86px;box-shadow:0 3px 3px rgba(0,0,0,0.2),0 30px 40px -18px rgba(0,0,0,0.7);}
.nk-polaroid .nk-ph{width:100%;height:100%;overflow:hidden;background:radial-gradient(70% 60% at 50% 60%,#8a6f52,#3b2f24);position:relative;}
.nk-polaroid .nk-ph img{position:absolute;left:0;bottom:0;width:100%;height:92%;object-fit:contain;object-position:50% 100%;}
.nk-polaroid .nk-cap{position:absolute;left:0;right:0;bottom:20px;text-align:center;font:400 38px var(--hand);color:#2A2622;}
.nk-cut{position:absolute;filter:drop-shadow(0 0 0 #F4EFE4) drop-shadow(4px 0 0 #F4EFE4) drop-shadow(-4px 0 0 #F4EFE4) drop-shadow(0 4px 0 #F4EFE4) drop-shadow(0 -4px 0 #F4EFE4) drop-shadow(10px 18px 14px rgba(0,0,0,0.55));}
.nk-cut.nk-clean{filter:drop-shadow(10px 18px 14px rgba(0,0,0,0.55));}
.nk-logo{position:absolute;background:#FBF9F4;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 2px rgba(0,0,0,0.2),0 22px 34px -14px rgba(0,0,0,0.6);}
.nk-logo img{max-width:76%;max-height:64%;object-fit:contain;}
.nk-tape{position:absolute;width:150px;height:44px;background:rgba(236,228,205,0.72);box-shadow:0 2px 3px rgba(0,0,0,0.18);z-index:21;}
.nk-stamp{position:absolute;padding:22px 34px;border:8px solid var(--marker);border-radius:14px;color:var(--marker);
  -webkit-mask:url('${tex}ink.png') 0 0/${TILE};mask:url('${tex}ink.png') 0 0/${TILE};
  font:700 66px/0.95 'Pragmatica Extended';letter-spacing:-0.02em;white-space:nowrap;}
.nk-folder{position:absolute;background:linear-gradient(180deg,#E4C98E,#D2B270);border-radius:18px;box-shadow:0 40px 60px -20px rgba(0,0,0,0.8);}
.nk-folder::after{content:'';position:absolute;inset:0;border-radius:18px;background:url('${tex}paper.png') 0 0/${TILE};opacity:0.5;mix-blend-mode:multiply;pointer-events:none;}

/* Printouts: an artifact recreated on office paper, never a copy of a product screen */
.nk-print{position:absolute;background:#FCFBF8;color:#1E1E1E;padding:44px 48px 52px;box-shadow:0 2px 2px rgba(0,0,0,0.2),0 26px 40px -16px rgba(0,0,0,0.6);font:400 34px/1.38 Roboto;}
.nk-print .nk-who{display:flex;align-items:center;gap:18px;margin-bottom:22px;}
.nk-print .nk-av{width:68px;height:68px;border-radius:50%;background:#D9D5CC;color:#55504A;display:flex;align-items:center;justify-content:center;font:700 30px Roboto;flex:none;}
.nk-print .nk-name{font:700 30px Roboto;}
.nk-print .nk-date{font:400 28px Roboto;color:#6b665e;margin-top:4px;}
.nk-print .nk-lh{font:700 22px Roboto;letter-spacing:0.22em;text-transform:uppercase;border-bottom:2px solid #1E1E1E;padding-bottom:12px;margin-bottom:24px;display:flex;justify-content:space-between;}
.nk-print.nk-statement{font:400 34px/1.45 var(--serif);}
.nk-print .nk-bubble{background:#ECE9E2;border-radius:28px;padding:22px 28px;}

/* Fasteners */
.nk-pin{position:absolute;width:40px;height:40px;margin:-20px 0 0 -20px;border-radius:50%;z-index:20;
  background:radial-gradient(circle at 34% 30%,#FF9A8A 0%,#E2382A 34%,#9E1A12 78%,#6B0E09 100%);
  box-shadow:0 0 0 1px rgba(0,0,0,0.25),9px 12px 10px -2px rgba(0,0,0,0.55),inset -3px -4px 6px rgba(0,0,0,0.35);}
.nk-pin::after{content:'';position:absolute;left:10px;top:7px;width:11px;height:8px;border-radius:50%;background:rgba(255,255,255,0.7);filter:blur(1px);}
.nk-pin.y{background:radial-gradient(circle at 34% 30%,#FFF1A8 0%,#F2C318 36%,#A9800A 80%,#6E5305 100%);}
.nk-pin.w{background:radial-gradient(circle at 34% 30%,#FFFFFF 0%,#E9E5DD 40%,#A7A194 85%,#7D776B 100%);}
.nk-pin.b{background:radial-gradient(circle at 34% 30%,#9DB7FF 0%,#2F5BE0 36%,#1A3399 80%,#0F1F5E 100%);}
.nk-cords{position:absolute;left:0;top:0;overflow:visible;z-index:15;pointer-events:none;}
.nk-cords .c{stroke:var(--cord);stroke-width:5;fill:none;stroke-linecap:round;}
.nk-cords .tw{stroke:#E0574A;stroke-width:2;fill:none;stroke-dasharray:3 7;opacity:0.7;}
.nk-cords .sh{stroke:rgba(0,0,0,0.45);stroke-width:5;fill:none;filter:blur(2.5px);}
.nk-mag{position:absolute;z-index:20;width:92px;height:92px;margin:-46px 0 0 -46px;border-radius:50%;
  box-shadow:0 7px 0 -1px var(--edge),0 9px 6px rgba(0,0,0,0.30),inset 0 0 0 2px rgba(255,255,255,0.18),inset 0 -10px 18px rgba(0,0,0,0.10);}
.nk-mag::after{content:'';position:absolute;inset:18px;border-radius:50%;background:radial-gradient(circle at 45% 40%,rgba(255,255,255,0.18),rgba(255,255,255,0) 70%);}
.nk-mag.bar{width:150px;height:46px;margin:-23px 0 0 -75px;border-radius:10px;}
.nk-mag.bar::after{inset:8px 14px;border-radius:6px;}
.mg-orange{background:#F25A1C;--edge:#A63A0E;} .mg-blue{background:#3E63D6;--edge:#253E91;} .mg-teal{background:#16AEB9;--edge:#0B6F78;}
.mg-yellow{background:#F7C21A;--edge:#AE820C;} .mg-black{background:#2A2A2A;--edge:#0E0E0E;} .mg-red{background:#D2372B;--edge:#8E1F17;}

/* Marks */
.nk-ink{position:absolute;left:0;top:0;overflow:visible;z-index:25;pointer-events:none;}
.nk-ink path{fill:none;stroke-linecap:round;stroke-linejoin:round;}
.nk-ink.dry{-webkit-mask:url('${tex}dryerase.png') 0 0/${TILE};mask:url('${tex}dryerase.png') 0 0/${TILE};}
.nk-ink path.hl{stroke-linecap:butt;mix-blend-mode:multiply;}
.nk-note{position:absolute;font-family:var(--hand);white-space:nowrap;z-index:26;}
.nk-note.dry{-webkit-mask:url('${tex}dryerase.png') 0 0/${TILE};mask:url('${tex}dryerase.png') 0 0/${TILE};}

/* ── Reel AI Drama: full-screen treatments (rd-*) ─────────────────────────────────── */
.rd{--rd-orange:${HELIOS.orange};--rd-paper-lit:${HELIOS.paperLit};--rd-ink:${HELIOS.ink};--rd-night:${HELIOS.night};
  position:absolute;left:0;top:0;width:1080px;height:1920px;overflow:hidden;background:var(--rd-night);-webkit-font-smoothing:antialiased;}
.rd *{box-sizing:border-box;}
.rd .abs,.rd-layer{position:absolute;}
.rd-layer{left:0;top:0;width:1080px;height:1920px;transform-origin:0 0;}
.rd-img{position:absolute;display:block;max-width:none;}
.rd-cover{position:absolute;left:0;top:0;width:1080px;height:1920px;object-fit:cover;display:block;}
.rd-tint{position:absolute;inset:0;pointer-events:none;mix-blend-mode:soft-light;}
.rd-shade{position:absolute;inset:0;pointer-events:none;}
.rd-vignette{position:absolute;inset:0;pointer-events:none;z-index:48;background:radial-gradient(ellipse at 50% 45%,transparent 45%,rgba(0,0,0,0.6) 100%);}
.rd .nk-grain{z-index:50;}
.rd-close{background:radial-gradient(ellipse at 40% 45%,#1d1916 0%,var(--rd-night) 70%);}
.rd-wordmark{font:700 104px/1 'Pragmatica Extended',Helvetica,Arial,sans-serif;letter-spacing:-0.03em;color:var(--rd-paper-lit);white-space:nowrap;}
.rd-series{font:500 38px Roboto,sans-serif;color:rgba(254,249,243,0.8);letter-spacing:0.01em;}
.rd-words{position:absolute;z-index:46;}
.rd-big{font:700 118px/1 'Pragmatica Extended',Helvetica,Arial,sans-serif;letter-spacing:-0.03em;color:var(--rd-paper-lit);white-space:nowrap;}
.rd-sub{font:700 54px/1.1 'Pragmatica Extended',Helvetica,Arial,sans-serif;letter-spacing:-0.02em;text-transform:lowercase;color:var(--rd-orange);margin-top:14px;}
.rd-label{font:500 38px/1.2 Roboto,sans-serif;color:rgba(254,249,243,0.8);margin-top:16px;}
.rd-l3-bar{width:84px;height:8px;background:var(--rd-orange);margin-bottom:22px;}
.rd-l3-name{font:700 76px/1 'Pragmatica Extended',Helvetica,Arial,sans-serif;letter-spacing:-0.02em;color:var(--rd-paper-lit);white-space:nowrap;}
.rd-l3-role{font:500 36px/1.2 Roboto,sans-serif;color:rgba(254,249,243,0.75);margin-top:14px;}
.rd-credit{position:absolute;left:96px;top:1560px;z-index:47;font:400 20px Roboto,sans-serif;color:rgba(254,249,243,0.55);letter-spacing:0.02em;white-space:nowrap;}
.rd-credit.on-light{color:rgba(31,25,21,0.6);}
.rd-ink{position:absolute;left:0;top:0;overflow:visible;pointer-events:none;}
.rd-ink path{fill:none;stroke-linecap:round;stroke-linejoin:round;}
.rd-ink path.hl{stroke-linecap:butt;mix-blend-mode:multiply;}
.rd-sheet{position:absolute;box-shadow:0 30px 80px rgba(0,0,0,0.7);transform-origin:0 0;}
.rd-paper::after{content:'';position:absolute;inset:0;pointer-events:none;background:url('${tex}paper.png') 0 0/${TILE};opacity:0.5;mix-blend-mode:multiply;}
.rd-postcard{border-radius:28px;overflow:hidden;}
.rd-pin{position:absolute;width:38px;height:38px;margin:-19px 0 0 -19px;border-radius:50%;background:var(--rd-orange);border:6px solid var(--rd-paper-lit);box-shadow:0 4px 14px rgba(0,0,0,0.45);z-index:5;}
.rd-maplabel{position:absolute;background:var(--rd-paper-lit);padding:16px 22px;box-shadow:0 6px 18px rgba(0,0,0,0.3);z-index:6;white-space:nowrap;}
.rd-maplabel .t{font:700 36px 'Pragmatica Extended',Helvetica,Arial,sans-serif;letter-spacing:-0.01em;color:var(--rd-ink);}
.rd-maplabel .s{font:500 28px Roboto,sans-serif;color:#525252;margin-top:6px;}
.rd-strip{position:absolute;background:#EFE7D6;color:#1B1A17;padding:34px 44px 40px;box-shadow:0 26px 50px -16px rgba(0,0,0,0.75);}
.rd-strip::after{content:'';position:absolute;inset:0;pointer-events:none;background:url('${tex}paper.png') 0 0/${TILE};opacity:0.55;mix-blend-mode:multiply;}
.rd-strip .k{font:700 24px Roboto,sans-serif;letter-spacing:0.18em;text-transform:uppercase;border-bottom:2px solid #1B1A17;padding-bottom:10px;display:flex;justify-content:space-between;}
.rd-strip .hl{font:700 70px/1.02 'Tinos','Times New Roman',serif;letter-spacing:-0.01em;margin-top:18px;}
`;
