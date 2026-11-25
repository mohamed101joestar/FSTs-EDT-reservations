const activite = require('../services/activiteService');
const moduleModel = require('../models/moduleModel');

const ajouterModule = async (req, res) => {
    try {
        const { nom_module, code_module } = req.body;
        if (!nom_module || !code_module) return res.status(400).json({ message: "nom_module et code_module sont obligatoires." });

        const nouveauModule = await moduleModel.createModule(nom_module, code_module);
        await activite.creation('module', nouveauModule, req.user.id);
        res.status(201).json({ message: "Module créé", module: nouveauModule });
    } catch (error) {
        if (error.code === '23505') return res.status(400).json({ message: "Ce code module existe déjà." });
        res.status(500).json({ message: "Erreur lors de la création." });
    }
};

const listerModules = async (req, res) => {
    try {
        const modules = await moduleModel.getAllModules();
        res.status(200).json(modules);
    } catch (error) {
        res.status(500).json({ message: "Erreur lors de la récupération." });
    }
};

const supprimerModule = async (req, res) => {
    try {
        const { id } = req.params;
        const moduleSupprime = await moduleModel.deleteModule(id);
        if (!moduleSupprime) return res.status(404).json({ message: "Module non trouvé." });
        await activite.suppression('module', moduleSupprime, req.user.id);
        res.status(200).json({ message: "Module supprimé." });
    } catch (error) {
        if (error.code === '23503') return res.status(400).json({ message: "Impossible de supprimer : ce module est utilisé dans une séance." });
        res.status(500).json({ message: "Erreur lors de la suppression." });
    }
};

module.exports = { ajouterModule, listerModules, supprimerModule };