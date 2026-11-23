const express = require('express');
const router = express.Router();
const demandeController = require('../controllers/demandeChangementController');
const { proteger } = require('../middlewares/authMiddleware');
const { autoriserRoles } = require('../middlewares/roleMiddleware');

router.use(proteger);

// Seul l'enseignant propriétaire d'une séance peut demander un changement (le service vérifie la propriété)
router.post('/', autoriserRoles('enseignant'), demandeController.demanderChangement);

// Tout utilisateur connecté : l'enseignant voit les siennes, l'admin voit tout (?statut=en_attente pour filtrer)
router.get('/', demandeController.listerDemandes);

// Seul l'admin traite
router.put('/:id/traiter', autoriserRoles('admin'), demandeController.traiterDemande);

// L'admin propose une alternative (autre créneau / autre salle) : validée et acceptée directement
router.put('/:id/reaffecter', autoriserRoles('admin'), demandeController.reaffecterDemande);

module.exports = router;
