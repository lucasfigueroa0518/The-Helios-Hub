// The drawn subject library (drawn.js): the animals and organic props the kit ships, each a drawn
// spec. A subject the library lacks is drawn as a new spec in the same format (drawn.js header).
import { DOG } from './dog.js';
import { CAT } from './cat.js';
import { PIGEON } from './bird.js';
import { SHOE } from './shoe.js';
import { BONE } from './bone.js';
import { PLANT } from './plant.js';
import { CROISSANT } from './croissant.js';
import { BACKPACK } from './backpack.js';
import { BALL_SPEC } from './ball.js';
import { PIGGY_BANK } from './piggybank.js';
import { TREE } from './tree.js';

export { DOG, CAT, PIGEON, SHOE, BONE, PLANT, CROISSANT, BACKPACK, BALL_SPEC, PIGGY_BANK, TREE };
/** Name → spec. `bird` is the pigeon. */
export const SUBJECTS = { dog: DOG, cat: CAT, bird: PIGEON, shoe: SHOE, bone: BONE, plant: PLANT, croissant: CROISSANT, backpack: BACKPACK, ball: BALL_SPEC, 'piggy bank': PIGGY_BANK, tree: TREE };
