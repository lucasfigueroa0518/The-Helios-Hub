import { NextResponse } from 'next/server';

export type SlideDeps = {
  session: () => Promise<unknown>;
  /** field_notes.posts.slide_objects for the post, or null when the post is unknown. */
  slideObjects: (postId: string) => Promise<unknown>;
  sign: (objectPath: string, expiresIn: number) => Promise<string>;
};

/** A rendered Field Notes slide JPEG through a short signed URL (the bucket stays private). */
export async function slideResponse(deps: SlideDeps, postId: string, n: string): Promise<Response> {
  if (!(await deps.session())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const index = Number(n);
  if (!/^[0-9a-f-]{36}$/i.test(postId) || !Number.isInteger(index) || index < 0) return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  const objects = await deps.slideObjects(postId);
  const path = Array.isArray(objects) && typeof objects[index] === 'string' ? (objects[index] as string) : null;
  if (!path) return NextResponse.json({ error: 'Not rendered yet.' }, { status: 404 });
  return NextResponse.redirect(await deps.sign(path, 600));
}
