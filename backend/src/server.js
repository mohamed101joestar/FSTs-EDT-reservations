const app = require('./app');
const pool = require('./config/db'); // On importe pour tester la connexion

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(` Serveur backend démarré sur http://localhost:${PORT}`);
});