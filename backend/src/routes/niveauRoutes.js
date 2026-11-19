const express = require('express');
const router = express.Router();
const niveauController = require('../controllers/niveauController');
const { proteger } = require('../middlewares/authMiddleware');
const { autoriserRoles } = require('../middlewares/roleMiddleware');

router.use(proteger);
router.get('/', niveauController.listerNiveaux);
router.post('/', autoriserRoles('admin'), niveauController.ajouterNiveau);
router.delete('/:id', autoriserRoles('admin'), niveauController.supprimerNiveau);

module.exports = router;