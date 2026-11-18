const express = require('express');
const router = express.Router();
const evenementController = require('../controllers/evenementController');
const { proteger } = require('../middlewares/authMiddleware');
const { autoriserRoles } = require('../middlewares/roleMiddleware');

router.use(proteger);
router.get('/', evenementController.listerEvenements);
router.post('/', autoriserRoles('admin'), evenementController.ajouterEvenement);
router.delete('/:id', autoriserRoles('admin'), evenementController.supprimerEvenement);

module.exports = router;