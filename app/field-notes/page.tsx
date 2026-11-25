import { ContentTypePage } from '@/components/content-type/ContentTypePage';
import { FieldNotesTop } from '@/components/field-notes/FieldNotesTop';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Field Notes', robots: { index: false, follow: false } };

/**
 * Field Notes, through the same generic content-type page as AI Events. The upload box, the photo pool
 * and the review panel are Field Notes' own and plug in through the shell's `top` slot.
 */
export default function Page() {
  return <ContentTypePage vertical="field_notes" top={<FieldNotesTop />} />;
}
