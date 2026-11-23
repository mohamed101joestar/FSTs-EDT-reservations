const reservationModel = require('../models/reservationModel');
const reservationService = require('../services/reservationService');
const conflitService = require('../services/conflitService');

const estIdValide = (v) => Number.isInteger(Number(v)) && Number(v) > 0;
const estAbsent = (v) => v === undefined || v === null || v === '';

// Occupation d'une réservation (avec son créneau) pour détecter les demandes concurrentes
const occupationDe = async (reservation, salle_id, creneau_id) => {
    const creneau = await reservationModel.getCreneau(creneau_id);
    return conflitService.occupationReservation({
        id: reservation.id, salle_id, enseignant_id: reservation.enseignant_id, groupe_id: reservation.groupe_id,
        date_creneau: creneau.date_creneau, jour: creneau.jour, heure_debut: creneau.heure_debut, heure_fin: creneau.heure_fin,
    });
};

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
        await conflitService.recalculerConflitsSansErreur();
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

        if (statut === 'rejetee') {
            const resaMiseAJour = await reservationModel.updateStatutReservation(id, statut, motif_rejet, admin_id);
            if (!resaMiseAJour) return res.status(409).json({ message: "Cette réservation vient d'être traitée par un autre administrateur." });
            await conflitService.recalculerConflitsSansErreur();
            return res.status(200).json({ message: `Réservation ${statut}.`, reservation: resaMiseAJour, refusees: [] });
        }

        // Confirmation : on revérifie tout, puis on confirme ET on refuse les demandes qui se disputaient la place
        const erreur = await reservationService.verifierDisponibilite(reservation.enseignant_id, reservation.salle_id, reservation.creneau_id, reservation.groupe_id);
        if (erreur) return res.status(erreur.status).json({ message: `Impossible de confirmer : ${erreur.message}` });

        const occupation = await occupationDe(reservation, reservation.salle_id, reservation.creneau_id);
        const { resultat, refusees } = await conflitService.accepterEnRefusantConcurrents(
            occupation, (client) => reservationModel.updateStatutReservation(id, 'confirmee', null, admin_id, client), admin_id);
        if (!resultat) return res.status(409).json({ message: "Cette réservation vient d'être traitée par un autre administrateur." });

        await conflitService.recalculerConflitsSansErreur();
        res.status(200).json({ message: `Réservation ${statut}.`, reservation: resultat, refusees });
    } catch (error) {
        if (error.code === '23505') return res.status(409).json({ message: "Impossible de confirmer : la salle a déjà une réservation confirmée sur ce créneau." });
        console.error(error);
        res.status(500).json({ message: "Erreur interne." });
    }
};

// L'admin propose une alternative (autre salle et/ou autre créneau) : elle est validée tout de suite
// et la réservation est confirmée directement.
const reaffecterReservation = async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id)) return res.status(400).json({ message: "Identifiant de réservation invalide." });

        const { salle_id, creneau_id } = req.body || {};
        if (estAbsent(salle_id) && estAbsent(creneau_id)) {
            return res.status(400).json({ message: "Indiquez une nouvelle salle (salle_id) et/ou un nouveau créneau (creneau_id)." });
        }
        if ((!estAbsent(salle_id) && !estIdValide(salle_id)) || (!estAbsent(creneau_id) && !estIdValide(creneau_id))) {
            return res.status(400).json({ message: "salle_id et creneau_id doivent être des identifiants valides." });
        }

        const reservation = await reservationModel.getReservationById(id);
        if (!reservation) return res.status(404).json({ message: "Réservation introuvable." });
        if (reservation.statut !== 'en_attente') {
            return res.status(400).json({ message: "Cette réservation a déjà été traitée." });
        }

        const nouvelleSalle = estAbsent(salle_id) ? Number(reservation.salle_id) : Number(salle_id);
        const nouveauCreneau = estAbsent(creneau_id) ? Number(reservation.creneau_id) : Number(creneau_id);
        if (nouvelleSalle === Number(reservation.salle_id) && nouveauCreneau === Number(reservation.creneau_id)) {
            return res.status(400).json({ message: "Aucun changement : utilisez /traiter pour confirmer cette réservation telle quelle." });
        }

        // Mêmes règles que pour une nouvelle demande (conflits, capacité, salle disponible, date, créneau daté)
        const erreur = await reservationService.verifierDisponibilite(reservation.enseignant_id, nouvelleSalle, nouveauCreneau, reservation.groupe_id);
        if (erreur) return res.status(erreur.status).json({ message: `Réaffectation impossible : ${erreur.message}` });

        const occupation = await occupationDe(reservation, nouvelleSalle, nouveauCreneau);
        const { resultat, refusees } = await conflitService.accepterEnRefusantConcurrents(
            occupation,
            (client) => reservationModel.reaffecterEtConfirmer(id, nouvelleSalle, nouveauCreneau, req.user.id, client),
            req.user.id);
        if (!resultat) return res.status(409).json({ message: "Cette réservation vient d'être traitée par un autre administrateur." });

        await conflitService.recalculerConflitsSansErreur();
        res.status(200).json({ message: "Réservation réaffectée et confirmée.", reservation: resultat, refusees });
    } catch (error) {
        if (error.code === '23503') return res.status(400).json({ message: "Un des IDs fournis n'existe pas." });
        if (error.code === '23505') return res.status(409).json({ message: "Réaffectation impossible : la salle a déjà une réservation confirmée sur ce créneau." });
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
        await conflitService.recalculerConflitsSansErreur();
        res.status(200).json({ message: "Réservation annulée.", reservation: resaAnnulee });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Erreur interne." });
    }
};

module.exports = { demanderReservation, listerReservations, traiterReservation, reaffecterReservation, annulerReservation };;