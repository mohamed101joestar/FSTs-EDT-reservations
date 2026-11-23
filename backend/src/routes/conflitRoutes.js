const express = require('express');
const router = express.Router();
const conflitController = require('../controllers/conflitController');
const { proteger } = require('../middlewares/authMiddleware');
const { autoriserRoles } = require('../middlewares/roleMiddleware');

router.use(proteger);

// Réservé à l'admin : liste des conflits (?statut=ouvert pour ne voir que ceux à traiter)
router.get('/', autoriserRoles('admin'), conflitController.listerConflits);

module.exports = router;