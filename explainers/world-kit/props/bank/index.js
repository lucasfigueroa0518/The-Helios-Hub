// The asset bank's drawings (Explainers 3.6, EX3-114), generated from the manifests beside it by
// lib/explainers/render/bank.ts and props/catalog.mjs --index. Never edit by hand.

import * as m0 from './b523d37c-new-props.js';
import * as m1 from './c56433e5-06-example.js';

const pick = (mod, names) => Object.fromEntries(names.map(([key, name]) => [key, { ...mod.NEW_PROPS[name], tags: mod.NEW_PROPS[name].tags }]));

export const BANK = {
  ...pick(m0, [["yellow library request slip","yellow library request slip"],["hardback library book with lilac spine tag","hardback library book with lilac spine tag"]]),
  ...pick(m1, [["store support chat window","store support chat window"]]),
};
