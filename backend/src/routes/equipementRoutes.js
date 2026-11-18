const express = require('express');
const router = express.Router({ mergeParams: true }); // Très important !
const equipementController = require('../controllers/equipementController');
const { autoriserRoles } = require('../middlewares/roleMiddleware');

// Routes : /api/salles/:salleId/equipements

router.get('/', equipementController.listerEquipements);
router.post('/', autoriserRoles('admin'), equipementController.ajouterEquipement);
router.put('/:idEquipement', autoriserRoles('admin'), equipementController.modifierEquipement);
router.delete('/:idEquipement', autoriserRoles('admin'), equipementController.supprimerEquipement);

module.exports = router;