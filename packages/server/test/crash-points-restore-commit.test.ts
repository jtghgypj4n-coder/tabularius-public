// See crash-points-harness.ts. Split restore phases to keep each file below 60 seconds.
import { crashSuite } from './crash-points-harness.ts';

crashSuite(['restore'], ['after-save', 'after-publish', 'after-commit', 'after-cleanup']);
