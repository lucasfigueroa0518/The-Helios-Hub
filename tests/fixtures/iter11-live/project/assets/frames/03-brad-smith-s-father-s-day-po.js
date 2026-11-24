// Compiled from the director's plan by lib/reel-ai-drama/render/compile.ts. Never edit: change the plan.
import { compiledFrame } from '../kit/components/compiled.js';
export default compiledFrame({
 "treatment": "cutout_lift",
 "blueprint": {
  "ground": "V9",
  "style": "cutouts",
  "arrangement": "solo",
  "pieces": [
   {
    "id": "p_bg",
    "on": "",
    "asset": "V9",
    "fill": true
   },
   {
    "id": "p_brad",
    "on": "Microsoft president Brad Smith",
    "asset": "V32",
    "role": "lead",
    "label": "Brad Smith"
   },
   {
    "id": "p_ms",
    "on": "Microsoft president Brad Smith",
    "asset": "V1",
    "belongs": "p_brad",
    "until": "wrote that keeping children"
   }
  ],
  "labels": [],
  "speech": [
   {
    "on_piece": "p_brad",
    "text": "Keep children with their parents",
    "on": "wrote that keeping children",
    "until": "helps build a stronger country"
   },
   {
    "on_piece": "p_brad",
    "text": "It builds a stronger country",
    "on": "helps build a stronger country"
   }
  ],
  "marks": [],
  "arrows": [],
  "camera": {
   "move": "push",
   "stops": [
    {
     "on": "Microsoft president Brad Smith",
     "aim": "face:Brad Smith",
     "zoom": 1.1
    }
   ]
  },
  "sounds": [
   {
    "kind": "ambience",
    "what": "soft outdoor air, leaves rustling",
    "on": "",
    "dur": 8
   }
  ]
 },
 "known_names": [],
 "seed": 3002
});
