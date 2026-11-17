// Framer Motion's animation features, split out so the root layout ships only the
// small `m` + LazyMotion runtime; these load in the background after hydration
// (well before anyone opens the mobile drawer).
import { domAnimation } from 'framer-motion';

export default domAnimation;
