import {
  TypeSafeClient,
  type EntryType,
  type Questions,
  type SystemOneResult,
} from '@typesafe-ai/sdk';

import { JEV_MODEL } from '@/lib/reels/config';
import { RecordingJevRunner, type JevRunner, type JevTransport } from '@/lib/reels/jev/runner';

let client: TypeSafeClient | null = null;

function getClient(): TypeSafeClient {
  if (!client) {
    if (!process.env.TYPESAFE_API_KEY) {
      throw new Error('TYPESAFE_API_KEY is not set; Jev calls cannot run.');
    }
    // The alias is deliberate (D-021); the resolved versioned ID is logged per
    // call so a moved alias is visible rather than silent.
    client = new TypeSafeClient({ defaultModel: JEV_MODEL });
  }
  return client;
}

export const liveJevTransport: JevTransport = {
  systemOne<const Q extends Questions>(
    state: EntryType,
    questions: Q,
  ): Promise<SystemOneResult<Q>> {
    return getClient().systemOne({ state, questions });
  },
};

export function createLiveJevRunner(): JevRunner {
  return new RecordingJevRunner(liveJevTransport);
}
