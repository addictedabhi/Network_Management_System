// Finding 19: `SHARED_PACKAGE_VERSION` was removed. It duplicated package.json's version and
// drifted from it silently; a consumer that needs a version reads its own manifest (see the
// BFF's `version.ts`), so there is exactly one source of truth per package.

export * from './errors/codes.js';
export * from './types/envelope.js';
export * from './types/metric.js';
export * from './types/alarm.js';
export * from './types/device.js';
export * from './types/session.js';
