// Compiled from the director's plan by lib/reel-ai-drama/render/compile.ts. Never edit: change the plan.
import { compiledFrame } from '../kit/components/compiled.js';
export default compiledFrame({
 "treatment": "collage",
 "blueprint": {
  "ground": "charcoal",
  "style": "paper",
  "arrangement": "leads_to",
  "pieces": [
   {
    "id": "p_hq",
    "on": "",
    "asset": "V8",
    "fill": true,
    "label": "Microsoft"
   },
   {
    "id": "p_nad",
    "on": "confirming only that Nadella got",
    "asset": "V75",
    "role": "lead",
    "until": "and its ICE work went"
   },
   {
    "id": "p_usb",
    "on": "the USB stick",
    "asset": "V79",
    "belongs": "p_nad",
    "until": "and its ICE work went"
   },
   {
    "id": "p_ice",
    "on": "and its ICE work went",
    "asset": "V44"
   }
  ],
  "labels": [],
  "speech": [],
  "marks": [],
  "arrows": [],
  "camera": {
   "move": "drift",
   "stops": [
    {
     "on": "confirming only that Nadella got",
     "aim": "p_nad",
     "zoom": 1.05
    },
    {
     "on": "and its ICE work went",
     "aim": "p_ice",
     "zoom": 1.15
    }
   ]
  },
  "sounds": [
   {
    "kind": "ambience",
    "what": "wind over a wide campus",
    "on": "",
    "dur": 6
   },
   {
    "kind": "impact",
    "what": "soft hit as the ICE seal lands",
    "on": "and its ICE work went"
   }
  ]
 },
 "known_names": [
  "Brad Smith",
  "More than 100"
 ]
});
