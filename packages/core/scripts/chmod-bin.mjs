import { chmodSync } from 'fs';

chmodSync('dist/src/bin/kadmium.js', 0o755);