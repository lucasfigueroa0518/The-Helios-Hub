import 'next/link';

declare module 'next/link' {
  interface LinkProps {
    /**
     * Full prefetch on hover. Next compiles this out unless
     * `experimental.dynamicOnHover` is on. Viewport prefetch stays partial.
     */
    unstable_dynamicOnHover?: boolean;
  }
}
