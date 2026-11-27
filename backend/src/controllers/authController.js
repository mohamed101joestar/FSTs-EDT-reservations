const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const userModel = require('../models/usermodel');
const activite = require('../services/activiteService');
const { validerChamps } = require('./utilisateurController');

// --- INSCRIPTION (publique) ---
// Toujours un compte "enseignant" : le rôle envoyé par le client est ignoré. Les admins se créent
// uniquement via la gestion des comptes (/api/utilisateurs). Fermeture complète : INSCRIPTION_PUBLIQUE=false.
const register = async (req, res) => {
    try {
        if (process.env.INSCRIPTION_PUBLIQUE === 'false') {
            return res.status(403).json({ message: "L'inscription est fermée : demandez la création de votre compte à un administrateur." });
        }
        const { erreur, valeurs } = validerChamps(req.body || {}, { complet: true });
        if (erreur) return res.status(400).json({ message: erreur });

        const existingUser = await userModel.getUserByEmail(valeurs.email);
        if(existingUser) {
            return res.status(400).json({ message: "cette email est déjà utilisée" });
        }

        const HashedPassword = await bcrypt.hash(valeurs.mot_de_passe, 10);
        const newUser = await userModel.createUser(valeurs.nom, valeurs.prenom, valeurs.email, HashedPassword, 'enseignant');
        await activite.inscription(newUser);
        res.status(201).json({ 
            message: "Utilisateur créé avec succès", 
            user: newUser });
        
    } catch(error) {
        console.error("erreur Lors de l'inscription:");
        console.error(error);

        res.status(500).json({ 
            message: "erreur lors de l'inscription",
            error: error.message
        });
    }
    
}

// --- CONNEXION ---
const connection = async (req, res) => {
    try {
        const { email, mot_de_passe } = req.body;

        const user = await userModel.getUserByEmail(email);
        if(!user) {
            return res.status(401).json({ message: "email ou mot de pass incorrect"});
        }

        const validePassword = await bcrypt.compare(mot_de_passe, user.mot_de_passe);
        if(!validePassword) {
            await activite.echecConnexion(user.id);
            return res.status(401).json({message: "Email ou mot de passe incorrect"});
        }
        // Mot de passe correct, mais compte désactivé par un administrateur
        if (!user.actif) {
            await activite.connexionRefusee(user.id);
            return res.status(403).json({ message: "Ce compte est désactivé. Contactez un administrateur." });
        }

        const token = jwt.sign(
        { id: user.id, role: user.role },
          process.env.JWT_SECRET,
        { expiresIn: '24h' }  
        );

        await activite.connexion(user.id);
        res.status(200).json({
        message: "Connexion réussie",
        token,
        user: {
        id: user.id,
        nom: user.nom,
        prenom: user.prenom,
        email: user.email,
        role: user.role
        }
        });

    } catch (error) {
        console.error("Erreur connexion :", error);
        res.status(500).json({ message: "Erreur interne lors de la connexion." });
    }
}

const getProfil = async (req, res) => {
    try {
        // req.user (id, rôle) est fourni par le middleware 'proteger' à partir de la base
        const utilisateur = await userModel.getUserById(req.user.id);
        res.status(200).json({ 
            message: "Voici votre profil", 
            utilisateur 
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Erreur interne." });
    }
};


module.exports = {
    register, 
    connection,
    getProfil
}
