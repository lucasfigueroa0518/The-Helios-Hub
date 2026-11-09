// Compiled from the director's plan by lib/reel-ai-drama/render/compile.ts. Never edit: change the plan.
import { compiledFrame } from '../kit/components/compiled.js';
export default compiledFrame({
 "treatment": "tableau",
 "blueprint": {
  "ground": "kraft",
  "style": "cutouts",
  "arrangement": "leads_to",
  "peak": true,
  "pieces": [
   {
    "id": "p_place",
    "on": "",
    "asset": "V62",
    "fill": true,
    "until": "an employee handed Nadella"
   },
   {
    "id": "p_nad",
    "on": "an employee handed Nadella",
    "asset": "V14",
    "role": "lead",
    "side": "right"
   },
   {
    "id": "p_usb",
    "on": "on a USB stick",
    "asset": "V74",
    "side": "left"
   }
  ],
  "labels": [],
  "speech": [],
  "marks": [],
  "arrows": [
   {
    "from": "p_usb",
    "to": "p_nad",
    "on": "on a USB stick"
   }
  ],
  "camera": {
   "move": "push",
   "stops": [
    {
     "on": "an employee handed Nadella",
     "aim": "face:Satya Nadella",
     "zoom": 1.1
    }
   ]
  },
  "sounds": [
   {
    "kind": "ambience",
    "what": "open campus plaza, light wind",
    "on": "",
    "dur": 3
   },
   {
    "kind": "click",
    "what": "small plastic click",
    "on": "on a USB stick"
   }
  ]
 },
 "known_names": [
  "Brad Smith",
  "More than 100"
 ],
 "seed": 11001
});
