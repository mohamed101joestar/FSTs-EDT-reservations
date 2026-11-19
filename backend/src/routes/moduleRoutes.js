const express = require('express');
const router = express.Router();
const moduleController = require('../controllers/moduleController');
const { proteger } = require('../middlewares/authMiddleware');
const { autoriserRoles } = require('../middlewares/roleMiddleware');

router.use(proteger);
router.get('/', moduleController.listerModules);
router.post('/', autoriserRoles('admin'), moduleController.ajouterModule);
router.delete('/:id', autoriserRoles('admin'), moduleController.supprimerModule);

module.exports = router;