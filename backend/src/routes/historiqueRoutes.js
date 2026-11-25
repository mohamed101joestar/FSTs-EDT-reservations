const express = require('express');
const router = express.Router();
const historiqueController = require('../controllers/historiqueController');
const { proteger } = require('../middlewares/authMiddleware');
const { autoriserRoles } = require('../middlewares/roleMiddleware');

router.use(proteger);

// Réservé à l'admin. Filtres : ?entite=&id_entite=&utilisateur_id=&action=&depuis=&jusqua=&limit=&offset=
router.get('/', autoriserRoles('admin'), historiqueController.listerHistorique);

module.exports = router;