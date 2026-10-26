## The story world (V-1)

A Real Case Reel lives in one world: the true event's setting and its things (RC-12). STORYBOARD.md's
`## Anchor scene` defines it once: the event's world, setting, ground, hook (the event's key moment),
the hero (the key item, an object), steps (each with its name and what it was in this event), entities
(what each is in the event and how it is built), states, layout. The scene builder turns it into
`assets/world/world.js`. Then:

- every entity is drawn by its one function and looks the same in every frame it appears in;
- every entity sits where `LAYOUT` puts it;
- every number, position, fill, label and outcome on screen comes from `STATES` and changes only by its
  rules, and every state comes from the event's facts;
- a frame that shows the world starts in the state the previous one ended in (the cut between them is a
  continuity cut);
- an entity enters only when the narration needs it, and never disappears without a cause the viewer
  sees.

Reusing the world gains the viewer's cached understanding: by the click they already know every object,
so the cause costs them nothing to see.
