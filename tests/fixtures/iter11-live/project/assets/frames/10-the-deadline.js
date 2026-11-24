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
    "id": "p_court",
    "on": "",
    "asset": "M6"
   },
   {
    "id": "p_ms",
    "on": "and employees chose that day",
    "asset": "V1"
   },
   {
    "id": "p_st",
    "on": "The Seattle Times reported",
    "asset": "V77"
   }
  ],
  "labels": [],
  "speech": [],
  "marks": [
   {
    "kind": "circle",
    "on_piece": "p_court",
    "on": "was July 26"
   }
  ],
  "arrows": [
   {
    "from": "p_court",
    "to": "p_ms",
    "on": "and employees chose that day"
   }
  ],
  "camera": {
   "move": "tour",
   "stops": [
    {
     "on": "children five and older",
     "aim": "p_court",
     "zoom": 1.2
    },
    {
     "on": "and employees chose that day",
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
 ],
 "seed": 10002
});
