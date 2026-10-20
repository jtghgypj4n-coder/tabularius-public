import { DATA_PATTERNS } from './data-patterns.ts';
import type { Pattern } from './framework.ts';
import { UI_PATTERNS } from './ui-patterns.ts';

export const PATTERNS: Pattern[] = [...DATA_PATTERNS, ...UI_PATTERNS];
