import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

/** The way back from a content type's page to the Social Hub's main page. */
export function BackToHub({ href = '/social' }: { href?: string }) {
  return (
    <Link href={href} className="rh-back">
      <ArrowLeft size={14} aria-hidden="true" /> Social Hub
    </Link>
  );
}
