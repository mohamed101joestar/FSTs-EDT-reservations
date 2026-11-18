const express = require('express');
const router = express.Router();
const salleController = require('../controllers/salleController');
const equipementRoutes = require('./equipementRoutes'); // Import du routeur d'équipements
const { proteger } = require('../middlewares/authMiddleware');
const { autoriserRoles } = require('../middlewares/roleMiddleware');

// Toutes les routes nécessitent d'être connecté
router.use(proteger);

// Routes pour les Salles
router.get('/', salleController.listerSalles);
router.post('/', autoriserRoles('admin'), salleController.ajouterSalle);
router.put('/:id', autoriserRoles('admin'), salleController.modifierSalle);
router.delete('/:id', autoriserRoles('admin'), salleController.supprimerSalle);

// On branche les routes d'équipements sur /:salleId/equipements
// Exemple : /api/salles/1/equipements
router.use('/:salleId/equipements', equipementRoutes);

module.exports = router;