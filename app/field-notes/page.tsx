import { ContentTypePage } from '@/components/content-type/ContentTypePage';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Field Notes', robots: { index: false, follow: false } };

/**
 * Field Notes, through the same generic content-type page as every other type (UI-REWORK-PLAN D2). The photo upload
 * and pool live in the Photo Bank's Field Notes section (the header's Photos link); a post's tips show in the post panel.
 */
export default function Page() {
  return <ContentTypePage vertical="field_notes" />;
}
