const activite = require('../services/activiteService');
const filiereModel = require('../models/filiereModel');

const ajouterFiliere = async (req, res) => {
    try {
        const { nom_filiere, code_filiere, niveau_id } = req.body;
        if (!nom_filiere || !code_filiere || !niveau_id) return res.status(400).json({ message: "nom_filiere, code_filiere et niveau_id sont obligatoires." });

        const nouvelleFiliere = await filiereModel.createFiliere(nom_filiere, code_filiere, niveau_id);
        await activite.creation('filiere', nouvelleFiliere, req.user.id);
        res.status(201).json({ message: "Filière créée", filiere: nouvelleFiliere });
    } catch (error) {
        if (error.code === '23505') return res.status(400).json({ message: "Ce code filière existe déjà." });
        if (error.code === '23503') return res.status(400).json({ message: "Le niveau_id fourni n'existe pas." });
        res.status(500).json({ message: "Erreur lors de la création." });
    }
};

const listerFilieres = async (req, res) => {
    try {
        const filieres = await filiereModel.getAllFilieres();
        res.status(200).json(filieres);
    } catch (error) {
        res.status(500).json({ message: "Erreur lors de la récupération." });
    }
};

const supprimerFiliere = async (req, res) => {
    try {
        const { id } = req.params;
        const filiereSupprimee = await filiereModel.deleteFiliere(id);
        if (!filiereSupprimee) return res.status(404).json({ message: "Filière non trouvée." });
        await activite.suppression('filiere', filiereSupprimee, req.user.id);
        res.status(200).json({ message: "Filière supprimée." });
    } catch (error) {
        if (error.code === '23503') return res.status(400).json({ message: "Impossible de supprimer : cette filière est utilisée par un groupe ou un EDT." });
        res.status(500).json({ message: "Erreur lors de la suppression." });
    }
};

module.exports = { ajouterFiliere, listerFilieres, supprimerFiliere };