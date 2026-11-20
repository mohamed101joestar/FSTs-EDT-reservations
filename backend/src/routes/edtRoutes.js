const express = require('express');
const router = express.Router();
const edtController = require('../controllers/edtController');
const seanceController = require('../controllers/seanceController');
const { proteger } = require('../middlewares/authMiddleware');
const { autoriserRoles } = require('../middlewares/roleMiddleware');

router.use(proteger);

// Routes EDT
router.get('/', edtController.listerEdts);
router.post('/', autoriserRoles('admin'), edtController.ajouterEdt);
router.delete('/:id', autoriserRoles('admin'), edtController.supprimerEdt);

// Routes Séances
router.get('/:edtId/seances', seanceController.listerSeancesParEdt);
router.post('/:edtId/seances', autoriserRoles('admin'), seanceController.ajouterSeance);
router.put('/:edtId/seances/:id', autoriserRoles('admin'), seanceController.modifierSeance); // <-- UPDATE AJOUTÉ
router.delete('/:edtId/seances/:id', autoriserRoles('admin'), seanceController.supprimerSeance);

module.exports = router;