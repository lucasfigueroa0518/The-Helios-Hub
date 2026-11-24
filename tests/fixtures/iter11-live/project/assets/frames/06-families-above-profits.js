// Compiled from the director's plan by lib/reel-ai-drama/render/compile.ts. Never edit: change the plan.
import { compiledFrame } from '../kit/components/compiled.js';
export default compiledFrame({
 "treatment": "stat",
 "blueprint": {
  "ground": "charcoal",
  "style": "cutouts",
  "arrangement": "leads_to",
  "pieces": [
   {
    "id": "p_letter",
    "on": "",
    "treatment": "document",
    "role": "lead",
    "opts": {
     "text": "We believe that Microsoft must take an ethical stand, and put children and families above profits",
     "speaker": "Open letter to Satya Nadella"
    },
    "until": "cancel its ICE contract"
   },
   {
    "id": "p_ms",
    "on": "",
    "asset": "V1",
    "belongs": "p_letter",
    "until": "put children and families above"
   },
   {
    "id": "p_ice",
    "on": "cancel its ICE contract",
    "asset": "V46",
    "until": "more than 19 million dollars"
   },
   {
    "id": "p_stat",
    "on": "more than 19 million dollars",
    "treatment": "stat",
    "opts": {
     "kind": "counter",
     "value": "$19 million",
     "title": "More than",
     "label": "ICE contract",
     "tone": "orange"
    }
   }
  ],
  "labels": [],
  "speech": [],
  "marks": [
   {
    "kind": "highlight",
    "on_piece": "p_letter",
    "target": "text:put children and families above profits",
    "on": "put children and families above"
   }
  ],
  "arrows": [],
  "camera": {
   "move": "push",
   "stops": [
    {
     "on": "put children and families above",
     "aim": "text:put children and families above profits",
     "zoom": 1.4
    }
   ]
  },
  "sounds": [
   {
    "kind": "foley",
    "what": "paper rustle",
    "on": "",
    "dur": 0.6
   },
   {
    "kind": "ambience",
    "what": "low office room tone",
    "on": "",
    "dur": 7
   }
  ]
 },
 "known_names": [
  "Brad Smith",
  "More than 100"
 ],
 "seed": 6002
});
