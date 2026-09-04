import { configureE2eEnvironment } from './database/test-environment.js';

configureE2eEnvironment();
await import('./server.js');
