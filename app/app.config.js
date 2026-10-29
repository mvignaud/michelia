const fs = require('fs');
const path = require('path');

// Fichier Firebase de l'appli Android (identifiants publics, versionnable d'après Expo) :
// app/google-services.json, ou la variable EAS de type fichier GOOGLE_SERVICES_JSON.
module.exports = ({ config }) => {
  const local = path.join(__dirname, 'google-services.json');
  const googleServicesFile = process.env.GOOGLE_SERVICES_JSON ?? (fs.existsSync(local) ? './google-services.json' : undefined);
  return googleServicesFile ? { ...config, android: { ...config.android, googleServicesFile } } : config;
};
