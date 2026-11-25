const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const userModel = require('../models/usermodel');
const activite = require('../services/activiteService');

// --- INSCRIPTION ---
const register = async (req, res) => {
    try {
        const  { nom, prenom, email, mot_de_passe, role } = req.body;
        const existingUser = await userModel.getUserByEmail(email);
        if(existingUser) {
            return res.status(400).json({ message: "cette email est déjà utilisée" });
        }

        const HashedPassword = await bcrypt.hash(mot_de_passe, 10);
        const newUser = await userModel.createUser(nom, prenom, email, HashedPassword, role || 'enseignant');
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

const getProfil = (req, res) => {
    // req.user est fourni par le middleware 'proteger'
    res.status(200).json({ 
        message: "Voici votre profil", 
        utilisateur: req.user 
    });
};


module.exports = {
    register, 
    connection,
    getProfil
}

