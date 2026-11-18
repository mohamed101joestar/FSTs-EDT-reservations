const equipementModel = require('../models/equipementModel');
const salleModel = require('../models/salleModel');

const ajouterEquipement = async (req, res) => {
    try {
        const { salleId } = req.params; // Récupéré depuis l'URL
        const { nom_equipement } = req.body;

        if (!nom_equipement) return res.status(400).json({ message: "Le nom de l'équipement est requis." });

        // Vérifier si la salle existe
        const salle = await salleModel.getSalleById(salleId);
        if (!salle) return res.status(404).json({ message: "Salle non trouvée." });

        const nouvelEquipement = await equipementModel.createEquipement(salleId, nom_equipement);
        res.status(201).json({ message: "Équipement ajouté", equipement: nouvelEquipement });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Erreur lors de l'ajout de l'équipement." });
    }
};

const listerEquipements = async (req, res) => {
    try {
        const { salleId } = req.params;
        const equipements = await equipementModel.getEquipementsBySalle(salleId);
        res.status(200).json(equipements);
    } catch (error) {
        res.status(500).json({ message: "Erreur lors de la récupération." });
    }
};

const modifierEquipement = async (req, res) => {
    try {
        const { idEquipement } = req.params;
        const { nom_equipement } = req.body;

        if (!nom_equipement) return res.status(400).json({ message: "Le nouveau nom est requis." });

        const equipementModifie = await equipementModel.updateEquipement(idEquipement, nom_equipement);
        if (!equipementModifie) return res.status(404).json({ message: "Équipement non trouvé." });

        res.status(200).json({ message: "Équipement modifié", equipement: equipementModifie });
    } catch (error) {
        res.status(500).json({ message: "Erreur lors de la modification." });
    }
};

const supprimerEquipement = async (req, res) => {
    try {
        const { idEquipement } = req.params;
        const equipementSupprime = await equipementModel.deleteEquipement(idEquipement);
        
        if (!equipementSupprime) return res.status(404).json({ message: "Équipement non trouvé." });
        res.status(200).json({ message: "Équipement supprimé avec succès." });
    } catch (error) {
        res.status(500).json({ message: "Erreur lors de la suppression." });
    }
};

module.exports = {
    ajouterEquipement,
    listerEquipements,
    modifierEquipement,
    supprimerEquipement
};