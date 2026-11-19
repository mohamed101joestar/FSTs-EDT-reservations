const niveauModel = require('../models/niveauModel');

const ajouterNiveau = async (req, res) => {
    try {
        const { libelle, code_niveau } = req.body;
        if (!libelle || !code_niveau) return res.status(400).json({ message: "libelle et code_niveau sont obligatoires." });

        const nouveauNiveau = await niveauModel.createNiveau(libelle, code_niveau);
        res.status(201).json({ message: "Niveau créé", niveau: nouveauNiveau });
    } catch (error) {
        if (error.code === '23505') return res.status(400).json({ message: "Ce code niveau existe déjà." });
        res.status(500).json({ message: "Erreur lors de la création." });
    }
};

const listerNiveaux = async (req, res) => {
    try {
        const niveaux = await niveauModel.getAllNiveaux();
        res.status(200).json(niveaux);
    } catch (error) {
        res.status(500).json({ message: "Erreur lors de la récupération." });
    }
};

const supprimerNiveau = async (req, res) => {
    try {
        const { id } = req.params;
        const niveauSupprime = await niveauModel.deleteNiveau(id);
        if (!niveauSupprime) return res.status(404).json({ message: "Niveau non trouvé." });
        res.status(200).json({ message: "Niveau supprimé." });
    } catch (error) {
        if (error.code === '23503') return res.status(400).json({ message: "Impossible de supprimer : ce niveau est utilisé par une filière." });
        res.status(500).json({ message: "Erreur lors de la suppression." });
    }
};

module.exports = { ajouterNiveau, listerNiveaux, supprimerNiveau };