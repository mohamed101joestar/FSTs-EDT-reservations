const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notificationController');
const { proteger } = require('../middlewares/authMiddleware');

// Chaque utilisateur (enseignant ou admin) ne voit et ne modifie que SES notifications
router.use(proteger);

router.get('/', notificationController.listerNotifications);          // ?non_lues=true&limit=&offset=
router.get('/non-lues', notificationController.compterNonLues);        // { non_lues: n }
router.put('/lues', notificationController.marquerToutesLues);         // tout marquer comme lu
router.put('/:id/lue', notificationController.marquerLue);             // marquer une notification comme lue

module.exports = router;