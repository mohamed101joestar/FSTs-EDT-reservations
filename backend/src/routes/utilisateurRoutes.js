const express = require('express');
const router = express.Router();
const utilisateurController = require('../controllers/utilisateurController');
const { proteger } = require('../middlewares/authMiddleware');
const { autoriserRoles } = require('../middlewares/roleMiddleware');

// Gestion des comptes : réservée aux administrateurs
router.use(proteger);
router.use(autoriserRoles('admin'));

router.get('/', utilisateurController.listerUtilisateurs);                 // ?role=&actif=&recherche=&limit=&offset=
router.post('/', utilisateurController.creerUtilisateur);
router.get('/:id', utilisateurController.voirUtilisateur);
router.put('/:id', utilisateurController.modifierUtilisateur);             // nom, prenom, email, role (partiel)
router.put('/:id/desactiver', utilisateurController.desactiverUtilisateur);
router.put('/:id/reactiver', utilisateurController.reactiverUtilisateur);
router.put('/:id/mot-de-passe', utilisateurController.reinitialiserMotDePasse);

module.exports = router;