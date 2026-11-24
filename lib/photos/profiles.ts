/**
 * What each content type asks of the shared photo finder (PHASE3-CONTRACT.md, Owner A).
 *
 * Floors match today's (checked 2026-11-10):
 *   - lib/social/photos/size.ts: an inner slide 600 (SLIDE_MIN_SHORT_SIDE), a cover 1080 (COVER_MIN_SHORT_SIDE),
 *     a logo exempt from the inner floor (it sits small on a plate). find.ts keeps that exemption.
 *   - lib/lfd/lead-image.ts: LEAD_MIN_WIDTH 600. A Last Few Days post has no cover photo, so its cover floor is 600 too.
 * Logos match today's rules: Last Few Days and the Stories series (MD, Trivia) never take a logo-only frame unless
 * the frame asks for a logo or a company; carousels place logos (the carousel logo lane).
 *
 * Stories Split (SS-20): 'trivia' keeps Guess the Number's old values (AI Trivia took over its profile and switch);
 * 'roa' is Real or AI?'s (lib/stories/roa/real.ts): open or government licences only, the credit kept off the frame
 * (the reveal carries it), at least 1200 px tall (MIN_HEIGHT), portrait or croppable to 9:16 (MAX_WIDE), and no faces,
 * brands or readable text (the bank's face boxes here, Jev's screen for the rest). Its photos come from the free
 * archives path (./archive.ts: the bank, Commons Featured/Quality, NASA), never the harvest.
 */
import { SHARED_PHOTO_CAP_USD, type PhotoProfile, type PhotoProfileId } from './types';

const profile = (id: PhotoProfileId, minShortSide: number, coverMinShortSide: number, allowLogo: boolean): PhotoProfile => ({
  id,
  minShortSide,
  coverMinShortSide,
  allowLogo,
  capUsd: SHARED_PHOTO_CAP_USD,
  licence: 'editorial_credited',
});

/** Real or AI?'s floor: a real photo fills a 1080×1920 Story without blowing up (lib/stories/roa/real.ts MIN_HEIGHT). */
export const ROA_MIN_HEIGHT = 1200;
/** Real or AI?'s widest photo: wider than 16:9 and too little survives the 9:16 cut (lib/stories/roa/generate.ts MAX_WIDE). */
export const ROA_MAX_ASPECT = 16 / 9;

export const PHOTO_PROFILES: Record<PhotoProfileId, PhotoProfile> = {
  lfd: profile('lfd', 600, 600, false),
  md: profile('md', 600, 1080, false),
  trivia: profile('trivia', 600, 1080, false),
  roa: {
    ...profile('roa', 0, 0, false),
    licence: 'open_or_government',
    sources: 'archives',
    creditOnFrame: false,
    minHeight: ROA_MIN_HEIGHT,
    maxAspect: ROA_MAX_ASPECT,
    refuse: ['faces', 'brands', 'text'],
  },
  carousel: profile('carousel', 600, 1080, true),
};
