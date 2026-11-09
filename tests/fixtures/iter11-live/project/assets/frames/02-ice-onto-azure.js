// Compiled from the director's plan by lib/reel-ai-drama/render/compile.ts. Never edit: change the plan.
import { compiledFrame } from '../kit/components/compiled.js';
export default compiledFrame({
 "treatment": "collage",
 "blueprint": {
  "ground": "kraft",
  "style": "paper",
  "arrangement": "leads_to",
  "pieces": [
   {
    "id": "p_ms",
    "on": "",
    "asset": "V52",
    "role": "lead",
    "side": "right"
   },
   {
    "id": "p_ice",
    "on": "announcing ICE's move",
    "asset": "V76",
    "side": "left"
   },
   {
    "id": "p_quote",
    "on": "called itself",
    "treatment": "document",
    "opts": {
     "text": "The agency is currently implementing transformative technologies for homeland security and public safety, and we're proud to support this work with our mission-critical cloud.",
     "speaker": "Microsoft blog"
    }
   }
  ],
  "labels": [],
  "speech": [],
  "marks": [
   {
    "kind": "highlight",
    "on_piece": "p_quote",
    "target": "text:proud to support this work",
    "on": "proud to support ICE's work"
   }
  ],
  "arrows": [
   {
    "from": "p_ice",
    "to": "p_ms",
    "on": "onto its government cloud"
   }
  ],
  "camera": {
   "move": "push",
   "stops": [
    {
     "on": "proud to support ICE's work",
     "aim": "text:proud to support this work",
     "zoom": 1.6
    }
   ]
  },
  "sounds": [
   {
    "kind": "ambience",
    "what": "quiet office hum",
    "on": "",
    "dur": 8
   },
   {
    "kind": "foley",
    "what": "paper card dropped on kraft",
    "on": "called itself",
    "dur": 0.4
   }
  ]
 },
 "known_names": [],
 "seed": 2002
});
