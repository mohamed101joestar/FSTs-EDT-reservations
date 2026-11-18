const express = require('express');
const router = express.Router();
const creneauController = require('../controllers/creneauController');
const { proteger } = require('../middlewares/authMiddleware');
const { autoriserRoles } = require('../middlewares/roleMiddleware');

router.use(proteger);
router.get('/', creneauController.listerCreneaux);
router.post('/', autoriserRoles('admin'), creneauController.ajouterCreneau);
router.delete('/:id', autoriserRoles('admin'), creneauController.supprimerCreneau);

module.exports = router;