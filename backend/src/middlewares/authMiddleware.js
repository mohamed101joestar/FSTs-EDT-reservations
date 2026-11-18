const jwt = require('jsonwebtoken');

const proteger = (req, res, next) => {
    // 1. Récupérer le token dans le header "Authorization" (format: "Bearer <token>")
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ message: "Accès refusé. Aucun token fourni." });
    }

    // 2. Extraire le token
    const token = authHeader.split(' ')[1];

    try {
        // 3. Vérifier le token avec le secret
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        // 4. Ajouter les infos de l'utilisateur à la requête pour les prochaines étapes
        req.user = decoded; 
        
        // 5. Passer au contrôleur suivant
        next();
    } catch (error) {
        return res.status(401).json({ message: "Token invalide ou expiré." });
    }
};

module.exports = { proteger };