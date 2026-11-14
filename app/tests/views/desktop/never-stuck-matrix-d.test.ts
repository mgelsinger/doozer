// @vitest-environment happy-dom
// One slice of the interruption matrix (stuck-matrix.ts): scenes 13 to 16 of 16.
import { afterEach, beforeEach } from 'vitest';
import { cleanUp, useFakeClock } from './harness';
import { describeMatrix } from './stuck-matrix';

beforeEach(useFakeClock);
afterEach(cleanUp);

describeMatrix(12, 16);
