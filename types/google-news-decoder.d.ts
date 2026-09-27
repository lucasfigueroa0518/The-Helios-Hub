/**
 * Ambient type declaration for the `google-news-decoder` npm package.
 * The package ships JS only. We use just the class default export and its
 * `decodeGoogleNewsUrl` method; declaring only what we call keeps drift
 * from the upstream unmapped.
 */
declare module 'google-news-decoder' {
  export default class GoogleNewsDecoder {
    decodeGoogleNewsUrl(url: string): Promise<{
      status: boolean;
      decodedUrl?: string;
      message?: string;
    }>;
  }
}
