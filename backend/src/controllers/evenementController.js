const activite = require('../services/activiteService');
const evenementModel = require('../models/evenementModel');

const ajouterEvenement = async (req, res) => {
    try {
        const { libelle } = req.body;
        if (!libelle) return res.status(400).json({ message: "Le libellé est obligatoire." });

        const nouvelEvenement = await evenementModel.createEvenement(libelle);
        await activite.creation('evenement', nouvelEvenement, req.user.id);
        res.status(201).json({ message: "Événement créé", evenement: nouvelEvenement });
    } catch (error) {
        if (error.code === '23505') return res.status(400).json({ message: "Cet événement existe déjà." });
        res.status(500).json({ message: "Erreur lors de la création." });
    }
};

const listerEvenements = async (req, res) => {
    try {
        const evenements = await evenementModel.getAllEvenements();
        res.status(200).json(evenements);
    } catch (error) {
        res.status(500).json({ message: "Erreur lors de la récupération." });
    }
};

const supprimerEvenement = async (req, res) => {
    try {
        const { id } = req.params;
        const evenementSupprime = await evenementModel.deleteEvenement(id);
        if (!evenementSupprime) return res.status(404).json({ message: "Événement non trouvé." });
        await activite.suppression('evenement', evenementSupprime, req.user.id);
        res.status(200).json({ message: "Événement supprimé." });
    } catch (error) {
        if (error.code === '23503') return res.status(400).json({ message: "Impossible de supprimer : cet événement est utilisé dans une séance." });
        res.status(500).json({ message: "Erreur lors de la suppression." });
    }
};

module.exports = { ajouterEvenement, listerEvenements, supprimerEvenement };