// Compiled from the director's plan by lib/reel-ai-drama/render/compile.ts. Never edit: change the plan.
import { compiledFrame } from '../kit/components/compiled.js';
export default compiledFrame({
 "treatment": "whiteboard",
 "blueprint": {
  "ground": "whiteboard",
  "style": "cutouts",
  "arrangement": "leads_to",
  "pieces": [
   {
    "id": "p_phone",
    "on": "",
    "asset": "M4"
   },
   {
    "id": "p_spread",
    "on": "went viral",
    "asset": "M5"
   },
   {
    "id": "p_ms",
    "on": "with calls to boycott",
    "asset": "V1"
   }
  ],
  "labels": [],
  "speech": [],
  "marks": [
   {
    "kind": "cross",
    "on_piece": "p_ms",
    "on": "boycott Microsoft"
   }
  ],
  "arrows": [
   {
    "from": "p_spread",
    "to": "p_ms",
    "on": "with calls to boycott"
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
    "what": "quiet room tone",
    "on": "",
    "dur": 5
   }
  ]
 },
 "known_names": []
});
