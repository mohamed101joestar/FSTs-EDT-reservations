const express = require('express');
const cors = require('cors');
const authRoutes = require('./routes/authRoutes');
const salleRoutes = require('./routes/salleRoutes');
const creneauRoutes = require('./routes/creneauRoutes');
const evenementRoutes = require('./routes/evenementRoutes');
const niveauRoutes = require('./routes/niveauRoutes');    
const filiereRoutes = require('./routes/filiereRoutes'); 
const groupeRoutes = require('./routes/groupeRoutes');  
const moduleRoutes = require('./routes/moduleRoutes'); 
const edtRoutes = require('./routes/edtRoutes');
const reservationRoutes = require('./routes/reservationRoutes');
const demandeChangementRoutes = require('./routes/demandeChangementRoutes');
const conflitRoutes = require('./routes/conflitRoutes');

const app = express();

app.use(cors());
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/salles', salleRoutes); 
app.use('/api/creneaux', creneauRoutes);    
app.use('/api/evenements', evenementRoutes); 
app.use('/api/niveaux', niveauRoutes);
app.use('/api/filieres', filiereRoutes);  
app.use('/api/groupes', groupeRoutes);
app.use('/api/modules', moduleRoutes);
app.use('/api/edts', edtRoutes);
app.use('/api/reservations', reservationRoutes);
app.use('/api/demandes-changement', demandeChangementRoutes);
app.use('/api/conflits', conflitRoutes);



// Une route de test simple
app.get('/api/health', (req, res) => {
  res.json({ message: "L'API fonctionne !" });
});

module.exports = app;