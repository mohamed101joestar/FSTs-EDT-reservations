const express = require('express');
const router = express.Router();
const filiereController = require('../controllers/filiereController');
const { proteger } = require('../middlewares/authMiddleware');
const { autoriserRoles } = require('../middlewares/roleMiddleware');

router.use(proteger);
router.get('/', filiereController.listerFilieres);
router.post('/', autoriserRoles('admin'), filiereController.ajouterFiliere);
router.delete('/:id', autoriserRoles('admin'), filiereController.supprimerFiliere);

module.exports = router;