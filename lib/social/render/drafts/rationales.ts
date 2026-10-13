import type { TemplateFamily } from './catalog';
import { RATIONALE as coverBleed } from './cover-bleed';
import { RATIONALE as coverIcon } from './cover-icon';
import { RATIONALE as coverLogo } from './cover-logo';
import { RATIONALE as coverSplit } from './cover-split';
import { RATIONALE as follow } from './follow';
import { RATIONALE as image } from './image';
import { RATIONALE as landing } from './landing';
import { RATIONALE as quote } from './quote';
import { RATIONALE as splitStat } from './split-stat';
import { RATIONALE as stat } from './stat';
import { RATIONALE as text } from './text';

export const RATIONALES: Record<TemplateFamily, string> = {
  'cover-bleed': coverBleed,
  'cover-split': coverSplit,
  'cover-logo': coverLogo,
  'cover-icon': coverIcon,
  text,
  landing,
  stat,
  'split-stat': splitStat,
  quote,
  image,
  follow,
};
