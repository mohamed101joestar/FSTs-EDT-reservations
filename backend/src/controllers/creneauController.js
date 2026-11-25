const activite = require('../services/activiteService');
const creneauModel = require('../models/creneauModel');

const ajouterCreneau = async (req, res) => {
    try {
        const { date_creneau, jour, heure_debut, heure_fin } = req.body;
        
        if (!jour || !heure_debut || !heure_fin) {
            return res.status(400).json({ message: "jour, heure_debut et heure_fin sont obligatoires." });
        }

        const nouveauCreneau = await creneauModel.createCreneau(date_creneau, jour, heure_debut, heure_fin);
        await activite.creation('creneau', nouveauCreneau, req.user.id);
        res.status(201).json({ message: "Créneau créé", creneau: nouveauCreneau });
    } catch (error) {
        if (error.code === '23505') {
            return res.status(400).json({ message: "Ce créneau existe déjà." });
        }
        console.error(error);
        res.status(500).json({ message: "Erreur lors de la création du créneau." });
    }
};

const listerCreneaux = async (req, res) => {
    try {
        const creneaux = await creneauModel.getAllCreneaux();
        res.status(200).json(creneaux);
    } catch (error) {
        res.status(500).json({ message: "Erreur lors de la récupération." });
    }
};

const supprimerCreneau = async (req, res) => {
    try {
        const { id } = req.params;
        const creneauSupprime = await creneauModel.deleteCreneau(id);
        if (!creneauSupprime) return res.status(404).json({ message: "Créneau non trouvé." });
        await activite.suppression('creneau', creneauSupprime, req.user.id);
        res.status(200).json({ message: "Créneau supprimé." });
    } catch (error) {
        if (error.code === '23503') return res.status(400).json({ message: "Impossible de supprimer : ce créneau est utilisé dans une séance." });
        res.status(500).json({ message: "Erreur lors de la suppression." });
    }
};

module.exports = { ajouterCreneau, listerCreneaux, supprimerCreneau };