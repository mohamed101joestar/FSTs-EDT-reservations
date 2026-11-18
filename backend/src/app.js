const express = require('express');
const cors = require('cors');
const authRoutes = require('./routes/authRoutes');

const app = express();

app.use(cors());
app.use(express.json());

app.use('/api/auth', authRoutes);


// Une route de test simple
app.get('/api/health', (req, res) => {
  res.json({ message: "L'API fonctionne !" });
});

module.exports = app;