// See crash-points-harness.ts.
import { crashSuite } from './crash-points-harness.ts';
import '../../cli/test/crash-upgrade.ts';

crashSuite(['host-conversion', 'host-upload']);
