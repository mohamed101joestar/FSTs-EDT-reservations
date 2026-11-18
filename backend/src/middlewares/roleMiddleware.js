// Cette fonction prend les rôles autorisés en paramètre (ex: 'admin', 'enseignant')
const autoriserRoles = (...rolesAutorises) => {
    return (req, res, next) => {
        // On suppose que req.user est défini par le middleware 'proteger' juste avant
        if (!req.user || !rolesAutorises.includes(req.user.role)) {
            return res.status(403).json({ 
                message: "Accès interdit. Vous n'avez pas les droits nécessaires." 
            });
        }
        next();
    };
};

module.exports = { autoriserRoles };