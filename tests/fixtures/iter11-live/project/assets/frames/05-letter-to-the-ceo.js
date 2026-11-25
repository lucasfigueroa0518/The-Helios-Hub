// Compiled from the director's plan by lib/reel-ai-drama/render/compile.ts. Never edit: change the plan.
import { compiledFrame } from '../kit/components/compiled.js';
export default compiledFrame({
 "treatment": "collision",
 "blueprint": {
  "ground": "kraft",
  "style": "cutouts",
  "arrangement": "face_off",
  "pieces": [
   {
    "id": "p_letter",
    "on": "",
    "treatment": "document",
    "asset": "V63",
    "side": "left"
   },
   {
    "id": "p_nad",
    "on": "CEO Satya Nadella",
    "asset": "V14",
    "role": "lead",
    "side": "right"
   }
  ],
  "labels": [
   {
    "text": "More than 100",
    "sub": "employee signatures",
    "for": "p_letter",
    "on": "more than 100 employee signatures"
   }
  ],
  "speech": [],
  "marks": [],
  "arrows": [],
  "camera": {
   "move": "drift",
   "stops": [
    {
     "on": "more than 100 employee signatures",
     "aim": "p_letter",
     "zoom": 1.1
    }
   ]
  },
  "sounds": [
   {
    "kind": "foley",
    "what": "paper laid on kraft",
    "on": "",
    "dur": 0.5
   },
   {
    "kind": "ambience",
    "what": "quiet office room tone",
    "on": "",
    "dur": 6
   }
  ]
 },
 "known_names": [
  "Brad Smith"
 ],
 "seed": 5002
});
