const fs = require('fs');
const path = require('path');

// Demo-only bridge: Expo normally loads .env files in this project directory,
// while this repository keeps the single ignored .env at Duo/.env. Map only
// the two Anthropic values needed by the mobile bundle before Metro resolves
// EXPO_PUBLIC_* references. Existing public values always win so CI can still
// provide a different, restricted key.
const rootEnv = path.join(__dirname, '..', '.env');
if (fs.existsSync(rootEnv)) {
  for (const line of fs.readFileSync(rootEnv, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*(ANTHROPIC_API_KEY|ANTHROPIC_MODEL)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    const [, name, rawValue] = match;
    const value = rawValue.replace(/^(['"])(.*)\1$/, '$2');
    const publicName = `EXPO_PUBLIC_${name}`;
    if (!process.env[publicName]) process.env[publicName] = value;
  }
}

module.exports = ({ config }) => ({ ...config, ...require('./app.json').expo });
