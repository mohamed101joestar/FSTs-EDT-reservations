const reservationModel = require('../models/reservationModel');
const reservationService = require('../services/reservationService');

const estIdValide = (v) => Number.isInteger(Number(v)) && Number(v) > 0;

const demanderReservation = async (req, res) => {
    try {
        const { salle_id, creneau_id, groupe_id, evenement_id } = req.body;
        const enseignant_id = req.user.id;

        if (![salle_id, creneau_id, groupe_id, evenement_id].every(estIdValide)) {
            return res.status(400).json({ message: "Tous les champs sont obligatoires (salle_id, creneau_id, groupe_id, evenement_id) et doivent être des identifiants valides." });
        }

        const erreur = await reservationService.verifierDisponibilite(enseignant_id, salle_id, creneau_id, groupe_id);
        if (erreur) return res.status(erreur.status).json({ message: erreur.message });

        const nouvelleResa = await reservationModel.createReservation(enseignant_id, salle_id, creneau_id, groupe_id, evenement_id);
        res.status(201).json({ message: "Demande de réservation envoyée.", reservation: nouvelleResa });
    } catch (error) {
        if (error.code === '23503') return res.status(400).json({ message: "Un des IDs fournis n'existe pas." });
        console.error(error);
        res.status(500).json({ message: "Erreur interne." });
    }
};

const listerReservations = async (req, res) => {
    try {
        // Un enseignant ne voit que ses réservations (filtre fait directement en SQL)
        const filtre = req.user.role === 'enseignant' ? req.user.id : null;
        const reservations = await reservationModel.getAllReservations(filtre);
        res.status(200).json(reservations);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Erreur interne." });
    }
};

const traiterReservation = async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id)) return res.status(400).json({ message: "Identifiant de réservation invalide." });

        const { statut, motif_rejet } = req.body;
        const admin_id = req.user.id;

        if (!['confirmee', 'rejetee'].includes(statut)) {
            return res.status(400).json({ message: "Statut invalide." });
        }
        if (statut === 'rejetee' && !motif_rejet) {
            return res.status(400).json({ message: "Un motif de rejet est obligatoire." });
        }

        const reservation = await reservationModel.getReservationById(id);
        if (!reservation) return res.status(404).json({ message: "Réservation introuvable." });
        if (reservation.statut !== 'en_attente') {
            return res.status(400).json({ message: "Cette réservation a déjà été traitée." });
        }

        if (statut === 'confirmee') {
            const erreur = await reservationService.verifierDisponibilite(reservation.enseignant_id, reservation.salle_id, reservation.creneau_id, reservation.groupe_id);
            if (erreur) return res.status(erreur.status).json({ message: `Impossible de confirmer : ${erreur.message}` });
        }

        const resaMiseAJour = await reservationModel.updateStatutReservation(id, statut, motif_rejet, admin_id);
        res.status(200).json({ message: `Réservation ${statut}.`, reservation: resaMiseAJour });
    } catch (error) {
        if (error.code === '23505') return res.status(409).json({ message: "Impossible de confirmer : la salle a déjà une réservation confirmée sur ce créneau." });
        console.error(error);
        res.status(500).json({ message: "Erreur interne." });
    }
};

const annulerReservation = async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id)) return res.status(400).json({ message: "Identifiant de réservation invalide." });

        const enseignant_id = req.user.id;

        const reservation = await reservationModel.getReservationById(id);
        if (!reservation) return res.status(404).json({ message: "Réservation introuvable." });

        if (Number(reservation.enseignant_id) !== Number(enseignant_id)) {
            return res.status(403).json({ message: "Vous ne pouvez annuler que vos propres réservations." });
        }

        if (!['en_attente', 'confirmee'].includes(reservation.statut)) {
            return res.status(400).json({ message: "Cette réservation ne peut plus être annulée." });
        }

        const resaAnnulee = await reservationModel.annulerReservation(id);
        res.status(200).json({ message: "Réservation annulée.", reservation: resaAnnulee });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Erreur interne." });
    }
};

module.exports = { demanderReservation, listerReservations, traiterReservation, annulerReservation };