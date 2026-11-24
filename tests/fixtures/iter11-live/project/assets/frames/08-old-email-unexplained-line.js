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
    "id": "p_ice",
    "on": "",
    "asset": "V45"
   },
   {
    "id": "p_contract",
    "on": "",
    "asset": "M3",
    "belongs": "p_ice"
   },
   {
    "id": "p_old",
    "on": "old email, calendar and documents",
    "asset": "M1"
   },
   {
    "id": "p_face",
    "on": "never explained the blog's",
    "asset": "M2"
   }
  ],
  "labels": [],
  "speech": [],
  "marks": [
   {
    "kind": "circle",
    "on_piece": "p_face",
    "on": "facial recognition line"
   },
   {
    "kind": "box",
    "on_piece": "p_contract",
    "on": "and kept the contract"
   }
  ],
  "arrows": [
   {
    "from": "p_contract",
    "to": "p_old",
    "on": "old email, calendar and documents"
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
    "dur": 8
   }
  ]
 },
 "known_names": [
  "Brad Smith",
  "More than 100"
 ]
});
