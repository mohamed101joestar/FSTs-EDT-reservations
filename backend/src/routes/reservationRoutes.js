const express = require('express');
const router = express.Router();
const resaController = require('../controllers/reservationController');
const { proteger } = require('../middlewares/authMiddleware');
const { autoriserRoles } = require('../middlewares/roleMiddleware');

router.use(proteger);

// Seul un enseignant peut créer une réservation
router.post('/', autoriserRoles('enseignant'), resaController.demanderReservation);

// Tout utilisateur connecté peut voir ses réservations (le contrôleur filtre)
router.get('/', resaController.listerReservations);

// Un enseignant peut annuler ses propres réservations (le contrôleur vérifie la propriété)
router.put('/:id/annuler', autoriserRoles('enseignant'), resaController.annulerReservation);

// Seul l'admin peut traiter
router.put('/:id/traiter', autoriserRoles('admin'), resaController.traiterReservation);

module.exports = router;