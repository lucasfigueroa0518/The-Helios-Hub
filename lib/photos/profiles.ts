/**
 * What each content type asks of the shared photo finder (PHASE3-CONTRACT.md, Owner A).
 *
 * Floors match today's (checked 2026-11-10):
 *   - lib/social/photos/size.ts: an inner slide 600 (SLIDE_MIN_SHORT_SIDE), a cover 1080 (COVER_MIN_SHORT_SIDE),
 *     a logo exempt from the inner floor (it sits small on a plate). find.ts keeps that exemption.
 *   - lib/lfd/lead-image.ts: LEAD_MIN_WIDTH 600. A Last Few Days post has no cover photo, so its cover floor is 600 too.
 * Logos match today's rules: Last Few Days and the Stories series (MD, GTN) never take a logo-only frame unless
 * the frame asks for a logo or a company; FvP and carousels place logos (the carousel logo lane).
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

export const PHOTO_PROFILES: Record<PhotoProfileId, PhotoProfile> = {
  lfd: profile('lfd', 600, 600, false),
  md: profile('md', 600, 1080, false),
  gtn: profile('gtn', 600, 1080, false),
  fvp: profile('fvp', 600, 1080, true),
  carousel: profile('carousel', 600, 1080, true),
};
