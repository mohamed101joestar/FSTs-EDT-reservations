const jwt = require('jsonwebtoken');
const userModel = require('../models/usermodel');

const proteger = async (req, res, next) => {
    // 1. Récupérer le token dans le header "Authorization" (format: "Bearer <token>")
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ message: "Accès refusé. Aucun token fourni." });
    }

    // 2. Vérifier le token avec le secret
    const token = authHeader.split(' ')[1];
    let decoded;
    try {
        decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (error) {
        return res.status(401).json({ message: "Token invalide ou expiré." });
    }

    // 3. Le compte doit exister ET être actif ; son rôle vient de la BASE, pas du token :
    //    un changement de rôle ou une désactivation par l'admin est effectif immédiatement.
    try {
        const utilisateur = await userModel.getAuthById(decoded.id);
        if (!utilisateur) return res.status(401).json({ message: "Compte introuvable." });
        if (!utilisateur.actif) return res.status(401).json({ message: "Ce compte est désactivé." });
        req.user = { id: utilisateur.id, role: utilisateur.role };
        next();
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Erreur interne." });
    }
};

module.exports = { proteger };