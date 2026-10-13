'use client';

import type { Post } from '@/lib/social/render/types';

import type { EyePath } from './blocks';
import { eyePathForCover } from './cover';
import { EYE_PATH as FOLLOW_PATH } from './follow';
import { EYE_PATH as IMAGE_PATH } from './image';
import { EYE_PATH as LANDING_PATH } from './landing';
import { EYE_PATH as QUOTE_PATH } from './quote';
import { EYE_PATH as SPLIT_STAT_PATH } from './split-stat';
import { EYE_PATH as STAT_PATH } from './stat';
import { EYE_PATH as TEXT_PATH } from './text';

/** The approved designs are now the production renderer (../SlideTemplate.tsx); the studio keeps this name. */
export { SlideTemplate as SlideTemplatePremium, type SlideTemplateProps as SlideTemplatePremiumProps } from '../SlideTemplate';

export function eyePathForSlide(post: Post, position: number): EyePath {
  const slide = post.slides[position];
  if (!slide) return [];
  let kind: string = slide.layoutVariant === 'story_beat' ? 'text' : slide.layoutVariant === 'data_block' ? 'stat' : slide.layoutVariant;
  const scenePhoto = Boolean(slide.photoUrl) && (slide.photoKind !== 'subject' || slide.photoBleed === true);
  if (slide.panoramaSide && scenePhoto && (kind === 'text' || kind === 'image' || kind === 'landing')) kind = 'spread';
  if (kind === 'image' && !scenePhoto) kind = 'text';
  if (kind === 'cover') return eyePathForCover(slide);
  if (kind === 'text') return TEXT_PATH;
  if (kind === 'landing') return LANDING_PATH;
  if (kind === 'stat') return STAT_PATH;
  if (kind === 'split_stat') return SPLIT_STAT_PATH;
  if (kind === 'quote') return QUOTE_PATH;
  if (kind === 'image' || kind === 'spread') return IMAGE_PATH;
  if (kind === 'follow') return FOLLOW_PATH;
  return [];
}
