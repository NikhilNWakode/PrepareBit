/**
 * The API validates its environment at import time and exits on failure, which
 * is the behaviour we want in production. Tests therefore need a valid, inert
 * configuration in place before any module is loaded.
 */
process.env['NODE_ENV'] = 'test';
process.env['MONGODB_URI'] ??= 'mongodb://127.0.0.1:27017/interview-prep-kit-test';
process.env['COOKIE_SECRET'] ??= 'test-cookie-secret-not-used-for-real';
process.env['WEB_ORIGIN'] ??= 'http://localhost:3000';
