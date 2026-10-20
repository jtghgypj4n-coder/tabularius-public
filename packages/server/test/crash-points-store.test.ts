// See crash-points-harness.ts.
import { crashSuite } from './crash-points-harness.ts';
import '../../store/test/crash-sync.ts';

crashSuite(['containers-out', 'containers-in', 'design-apply', 'compat', 'sync-apply']);
