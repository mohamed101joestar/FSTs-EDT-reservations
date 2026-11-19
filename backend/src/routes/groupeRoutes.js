const express = require('express');
const router = express.Router();
const groupeController = require('../controllers/groupeController');
const { proteger } = require('../middlewares/authMiddleware');
const { autoriserRoles } = require('../middlewares/roleMiddleware');

router.use(proteger);
router.get('/', groupeController.listerGroupes);
router.post('/', autoriserRoles('admin'), groupeController.ajouterGroupe);
router.delete('/:id', autoriserRoles('admin'), groupeController.supprimerGroupe);

module.exports = router;