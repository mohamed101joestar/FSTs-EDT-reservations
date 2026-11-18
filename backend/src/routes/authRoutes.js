const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { proteger } = require('../middlewares/authMiddleware');
const { autoriserRoles } = require('../middlewares/roleMiddleware');
// Route pour l'inscription
router.post('/register', authController.register);

// Route pour la connexion 
router.post('/login', authController.connection);

router.get('/profil', proteger, authController.getProfil);

// Route privée (nécessite d'être admin) - Juste pour tester
router.get('/admin-test', proteger, autoriserRoles('admin'), (req, res) => {
    res.json({ message: "Bienvenue Admin ! Vous avez accès à cette zone secrète." });
});

module.exports = router ; 

