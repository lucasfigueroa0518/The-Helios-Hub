// Frame 1's hook for the agent-loop reel of 2026-10-14, written to the hook contract (EX3-102) the
// way a frame worker writes it: the frosty room in motion, no title card, its critter as `hero`.

import { scope } from '../kit/draw.js';
import { twos, E, seg, lerp } from '../kit/motion.js';
import { shotFrame } from '../kit/shots.js';
import { PROJ, projection, LAYOUT, SUBJECTS, STATES, frostWindow, thermometer, target_mark, heater, thermostat } from '../world/world.js';

const GROUND = 'paper';

export const shots = [{ at: 0, kind: 'medium', on: SUBJECTS.heater, push: 1.1 }];

/** The hook's critter: its feet on the page (its LAYOUT spot), its scale, its id, its look. */
export const hero = { at: LAYOUT.thermostat.at, s: 1.3 * PROJ.s, who: 'thermostat', critter: { wear: ['scarf', 'cap'] } };

export default {
  ground: GROUND,
  shots,
  draw(t, { hideHero = false, heroPose = {} } = {}) {
    scope('f01h-', GROUND);
    const P = projection();
    const s = PROJ.s;
    const tc = twos(t);
    const state = { needle: STATES.needle.beat1, heater: STATES.heater.beat1, frost: STATES.frost.beat1, thermostat: STATES.thermostat.beat1 };
    const build = lerp(0.55, 1, seg(t, 0, 2, E['ramp-up']));
    const scene = () => [
      frostWindow(P, s, state),
      thermometer(P, s, state, { focal: true, shake: 2 + 4 * build, t: tc }),
      target_mark(P, s, state, {}),
      heater(P, s, state, { t: tc }),
      hideHero ? '' : thermostat(P, s, state, { t: tc, shiver: build, ...heroPose }),
    ].join('');
    return shotFrame(t, shots, scene);
  },
};
