// Compiled from the director's plan by lib/reel-ai-drama/render/compile.ts. Never edit: change the plan.
import { compiledFrame } from '../kit/components/compiled.js';
export default compiledFrame({
 "treatment": "stat",
 "blueprint": {
  "ground": "kraft",
  "style": "cutouts",
  "arrangement": "leads_to",
  "pieces": [
   {
    "id": "p_np",
    "on": "",
    "asset": "V71",
    "until": "more than 300,000 signatures"
   },
   {
    "id": "p_ms",
    "on": "demanding Microsoft cancel",
    "asset": "V52",
    "until": "more than 300,000 signatures"
   },
   {
    "id": "p_count",
    "on": "more than 300,000 signatures",
    "treatment": "stat",
    "opts": {
     "kind": "counter",
     "value": "300,000+",
     "label": "signatures",
     "tone": "orange"
    },
    "until": "500 from Microsoft staff"
   },
   {
    "id": "p_scale",
    "on": "500 from Microsoft staff",
    "treatment": "stat",
    "opts": {
     "kind": "scale",
     "items": [
      {
       "label": "Microsoft staff",
       "value": 500,
       "display": "500"
      },
      {
       "label": "signatures",
       "value": 300000,
       "display": "300,000+"
      }
     ]
    }
   }
  ],
  "labels": [],
  "speech": [],
  "marks": [],
  "arrows": [
   {
    "from": "p_np",
    "to": "p_ms",
    "on": "demanding Microsoft cancel"
   }
  ],
  "camera": {
   "move": "hold",
   "stops": [
    {
     "on": "",
     "aim": "whole"
    }
   ]
  },
  "sounds": [
   {
    "kind": "ambience",
    "what": "low room tone",
    "on": "",
    "dur": 6
   },
   {
    "kind": "foley",
    "what": "paper chip laid on kraft",
    "on": "demanding Microsoft cancel",
    "dur": 0.3
   }
  ]
 },
 "known_names": [
  "Brad Smith",
  "More than 100"
 ],
 "seed": 9002
});
