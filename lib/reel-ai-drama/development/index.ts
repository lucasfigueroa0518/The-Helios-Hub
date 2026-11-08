/** Reel AI Drama development (CONTRACT.md § B1): the exports other builders call. */
export { seedCells, pickCells, markSearched, newsTouching, type CellRow, type NewsItem } from '@/lib/reel-ai-drama/development/ledger';
export { producePitches, validatePitch, anthropicCreate, type ProducerDeps, type ProduceResult } from '@/lib/reel-ai-drama/development/producer';
export { eventKey, findDuplicate, SAME_EVENT_PAIRS } from '@/lib/reel-ai-drama/development/dedupe';
export { scoreDrama, scoreMaterial, DRAMA_SET, MATERIAL_SET } from '@/lib/reel-ai-drama/development/scores';
export { checkVisuals, liveVisualsCheckDeps, type VisualsCheckDeps } from '@/lib/reel-ai-drama/development/visuals-check';
export { rankScore, rankPool, nextForProduction, tendPool } from '@/lib/reel-ai-drama/development/pool';
export { runDevelopmentSession, type DevelopmentDeps, type SessionSummary } from '@/lib/reel-ai-drama/development/session';
export { runCalibration, seedCalibrationPitches, calibrationReport, type CalibrationReport } from '@/lib/reel-ai-drama/development/calibration';
