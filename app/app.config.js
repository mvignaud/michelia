const fs = require('fs');
const path = require('path');

// Fichier Firebase de l'appli Android, hors du dépôt public :
// variable EAS de type fichier GOOGLE_SERVICES_JSON, ou app/google-services.json en local.
module.exports = ({ config }) => {
  const local = path.join(__dirname, 'google-services.json');
  const googleServicesFile = process.env.GOOGLE_SERVICES_JSON ?? (fs.existsSync(local) ? './google-services.json' : undefined);
  return googleServicesFile ? { ...config, android: { ...config.android, googleServicesFile } } : config;
};
