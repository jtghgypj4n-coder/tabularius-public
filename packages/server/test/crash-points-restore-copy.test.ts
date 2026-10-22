// See crash-points-harness.ts. Replay restore coverage is unchanged; it runs
// separately from full-set restore crash tests to bound per-file time.
import { crashSuite } from './crash-points-harness.ts';

crashSuite(['restore-copy', 'restore-replace']);
