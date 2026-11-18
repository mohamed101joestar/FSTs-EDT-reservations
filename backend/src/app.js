const express = require('express');
const cors = require('cors');
const authRoutes = require('./routes/authRoutes');
const salleRoutes = require('./routes/salleRoutes');
const creneauRoutes = require('./routes/creneauRoutes');
const evenementRoutes = require('./routes/evenementRoutes');

const app = express();

app.use(cors());
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/salles', salleRoutes); 
app.use('/api/creneaux', creneauRoutes);    
app.use('/api/evenements', evenementRoutes); 


// Une route de test simple
app.get('/api/health', (req, res) => {
  res.json({ message: "L'API fonctionne !" });
});

module.exports = app;