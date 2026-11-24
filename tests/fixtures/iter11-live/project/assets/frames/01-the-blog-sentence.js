// Compiled from the director's plan by lib/reel-ai-drama/render/compile.ts. Never edit: change the plan.
import { compiledFrame } from '../kit/components/compiled.js';
export default compiledFrame({
 "treatment": "photo",
 "blueprint": {
  "ground": "charcoal",
  "style": "cutouts",
  "arrangement": "leads_to",
  "hook": {
   "text": "Against family separation. 'Proud to support' ICE.",
   "on": ""
  },
  "pieces": [
   {
    "id": "p_border",
    "on": "",
    "asset": "V70",
    "fill": true,
    "until": "its own blog said"
   },
   {
    "id": "p_ms",
    "on": "",
    "asset": "V1",
    "belongs": "p_border",
    "until": "its own blog said"
   },
   {
    "id": "p_blog",
    "on": "its own blog said",
    "treatment": "document",
    "role": "lead",
    "opts": {
     "text": "Azure Government enabling them to process data on edge devices or utilize deep learning capabilities to accelerate facial recognition and identification.",
     "speaker": "Microsoft blog"
    }
   },
   {
    "id": "p_azure",
    "on": "its cloud",
    "asset": "V47",
    "belongs": "p_blog",
    "until": "speed up facial recognition"
   },
   {
    "id": "p_ice",
    "on": "could help ICE",
    "asset": "V43",
    "belongs": "p_blog",
    "until": "speed up facial recognition"
   }
  ],
  "labels": [],
  "speech": [],
  "marks": [
   {
    "kind": "highlight",
    "on_piece": "p_blog",
    "target": "text:accelerate facial recognition and identification",
    "on": "speed up facial recognition"
   }
  ],
  "arrows": [],
  "camera": {
   "move": "push",
   "stops": [
    {
     "on": "separation of migrant children",
     "aim": "p_border",
     "zoom": 1.15
    },
    {
     "on": "speed up facial recognition",
     "aim": "text:accelerate facial recognition and identification",
     "zoom": 1.4
    }
   ]
  },
  "sounds": [
   {
    "kind": "ambience",
    "what": "low murmur of a large indoor hall",
    "on": "",
    "dur": 5
   },
   {
    "kind": "foley",
    "what": "paper card laid down",
    "on": "its own blog said",
    "dur": 0.4
   }
  ]
 },
 "known_names": [],
 "seed": 1002
});
