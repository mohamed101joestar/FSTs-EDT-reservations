const demandeModel = require('../models/demandeChangementModel');
const demandeService = require('../services/demandeChangementService');
const conflitService = require('../services/conflitService');
const activite = require('../services/activiteService');

const STATUTS = ['en_attente', 'acceptee', 'refusee'];
const estIdValide = (v) => Number.isInteger(Number(v)) && Number(v) > 0;
const estAbsent = (v) => v === undefined || v === null || v === '';

const reponseErreurSql = (error, res) => {
    if (error.code === '23503') return res.status(400).json({ message: "Un des IDs fournis n'existe pas." });
    if (error.code === '23514') return res.status(400).json({ message: "Données incohérentes pour ce type de demande." });
    if (error.code === '22001') return res.status(400).json({ message: "Un des textes est trop long (255 caractères maximum)." });
    console.error(error);
    return res.status(500).json({ message: "Erreur interne." });
};

const demanderChangement = async (req, res) => {
    try {
        const prep = await demandeService.preparerDemande(req.body || {}, req.user.id);
        if (prep.erreur) return res.status(prep.erreur.status).json({ message: prep.erreur.message });

        const erreur = await demandeService.verifierFaisabilite(prep.demande, prep.seance);
        if (erreur) return res.status(erreur.status).json({ message: erreur.message });

        const demande = await demandeModel.createDemande(prep.demande);
        await activite.demandeCreee(demande.id, req.user.id);
        await conflitService.recalculerConflitsSansErreur();
        res.status(201).json({ message: "Demande de changement envoyée.", demande });
    } catch (error) {
        reponseErreurSql(error, res);
    }
};

const listerDemandes = async (req, res) => {
    try {
        const { statut } = req.query;
        if (statut !== undefined && !STATUTS.includes(statut)) {
            return res.status(400).json({ message: "Statut invalide (en_attente, acceptee ou refusee)." });
        }
        const enseignant_id = req.user.role === 'enseignant' ? req.user.id : null;
        const demandes = await demandeModel.getAllDemandes({ enseignant_id, statut: statut || null });
        res.status(200).json(demandes);
    } catch (error) {
        reponseErreurSql(error, res);
    }
};

// Accepte une demande (éventuellement réaffectée par l'admin) et refuse, dans la même transaction,
// les demandes en attente qui se disputaient la même place.
const accepterAvecConcurrents = async (demande, seance, modifs, admin_id, reaffectee = false) => {
    const definitif = demande.type_demande === 'deplacement_definitif';
    const nouveauCreneauId = modifs ? modifs.nouveau_creneau_id : demande.nouveau_creneau_id;
    const nouvelleSalleId = modifs ? modifs.nouvelle_salle_id : demande.nouvelle_salle_id;
    const nouveauCreneau = nouveauCreneauId ? await demandeModel.getCreneau(nouveauCreneauId) : null;
    const occupation = conflitService.occupationDemandeDepuis(
        { ...demande, nouveau_creneau_id: nouveauCreneauId, nouvelle_salle_id: nouvelleSalleId }, seance, nouveauCreneau);

    return conflitService.accepterEnRefusantConcurrents(
        occupation,
        (client) => definitif
            ? demandeModel.accepterDemandeDefinitive(demande.id, admin_id, seance.id,
                nouveauCreneauId || seance.creneau_id, nouvelleSalleId || seance.salle_id, modifs, client)
            : demandeModel.accepterDemandePonctuelle(demande.id, admin_id, modifs, client),
        admin_id, undefined,
        (client, { refusees: detail }) => activite.demandeAcceptee(demande, seance, admin_id, detail, reaffectee, client));
};

const traiterDemande = async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id)) return res.status(400).json({ message: "Identifiant de demande invalide." });

        const { statut, motif_refus } = req.body || {};
        if (!['acceptee', 'refusee'].includes(statut)) {
            return res.status(400).json({ message: "Statut invalide (acceptee ou refusee)." });
        }
        if (statut === 'refusee') {
            if (typeof motif_refus !== 'string' || !motif_refus.trim()) {
                return res.status(400).json({ message: "Un motif de refus est obligatoire." });
            }
            if (motif_refus.trim().length > 255) {
                return res.status(400).json({ message: "Le motif est trop long (255 caractères maximum)." });
            }
        }

        const demande = await demandeModel.getDemandeById(id);
        if (!demande) return res.status(404).json({ message: "Demande introuvable." });
        if (demande.statut !== 'en_attente') {
            return res.status(400).json({ message: "Cette demande a déjà été traitée." });
        }

        let resultat;
        let refusees = [];
        if (statut === 'refusee') {
            resultat = await demandeModel.refuserDemande(id, motif_refus.trim(), req.user.id);
            if (resultat) await activite.demandeRefusee(id, motif_refus.trim(), req.user.id);
        } else {
            // Le planning a pu changer depuis la demande : on revérifie tout avant d'accepter.
            const seance = await demandeModel.getSeanceDetails(demande.seance_id);
            const erreur = await demandeService.verifierFaisabilite(demande, seance);
            if (erreur) return res.status(409).json({ message: `Impossible d'accepter : ${erreur.message}` });
            ({ resultat, refusees } = await accepterAvecConcurrents(demande, seance, null, req.user.id));
        }

        if (!resultat) return res.status(409).json({ message: "Cette demande vient d'être traitée par un autre administrateur." });
        await conflitService.recalculerConflitsSansErreur();
        res.status(200).json({ message: `Demande ${statut}.`, demande: resultat, refusees });
    } catch (error) {
        reponseErreurSql(error, res);
    }
};

// L'admin propose une alternative (autre créneau et/ou autre salle) : elle est validée tout de suite
// et la demande est acceptée directement.
const reaffecterDemande = async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id)) return res.status(400).json({ message: "Identifiant de demande invalide." });

        const { nouveau_creneau_id, nouvelle_salle_id } = req.body || {};
        if (estAbsent(nouveau_creneau_id) && estAbsent(nouvelle_salle_id)) {
            return res.status(400).json({ message: "Indiquez un nouveau créneau (nouveau_creneau_id) et/ou une nouvelle salle (nouvelle_salle_id)." });
        }

        const demande = await demandeModel.getDemandeById(id);
        if (!demande) return res.status(404).json({ message: "Demande introuvable." });
        if (demande.statut !== 'en_attente') {
            return res.status(400).json({ message: "Cette demande a déjà été traitée." });
        }
        if (demande.type_demande === 'annulation_ponctuelle') {
            return res.status(400).json({ message: "Une annulation n'a pas de destination à réaffecter." });
        }

        const modifs = {
            nouveau_creneau_id: estAbsent(nouveau_creneau_id) ? demande.nouveau_creneau_id : nouveau_creneau_id,
            nouvelle_salle_id: estAbsent(nouvelle_salle_id) ? demande.nouvelle_salle_id : nouvelle_salle_id,
        };

        // Mêmes contrôles qu'à la création, comme si l'enseignant avait demandé cette destination
        const prep = await demandeService.preparerDemande({
            type_demande: demande.type_demande, seance_id: demande.seance_id,
            date_occurrence: demande.date_occurrence, motif: demande.motif, ...modifs,
        }, demande.enseignant_id, { exclureDemandeId: id });
        if (prep.erreur) return res.status(prep.erreur.status).json({ message: `Réaffectation impossible : ${prep.erreur.message}` });

        const memeDestination = prep.demande.nouveau_creneau_id === (demande.nouveau_creneau_id ? Number(demande.nouveau_creneau_id) : null)
            && prep.demande.nouvelle_salle_id === (demande.nouvelle_salle_id ? Number(demande.nouvelle_salle_id) : null);
        if (memeDestination) {
            return res.status(400).json({ message: "Aucun changement : utilisez /traiter pour accepter cette demande telle quelle." });
        }

        const erreur = await demandeService.verifierFaisabilite(prep.demande, prep.seance);
        if (erreur) return res.status(erreur.status).json({ message: `Réaffectation impossible : ${erreur.message}` });

        const { resultat, refusees } = await accepterAvecConcurrents(
            demande, prep.seance,
            { nouveau_creneau_id: prep.demande.nouveau_creneau_id, nouvelle_salle_id: prep.demande.nouvelle_salle_id },
            req.user.id, true);
        if (!resultat) return res.status(409).json({ message: "Cette demande vient d'être traitée par un autre administrateur." });

        await conflitService.recalculerConflitsSansErreur();
        res.status(200).json({ message: "Demande réaffectée et acceptée.", demande: resultat, refusees });
    } catch (error) {
        reponseErreurSql(error, res);
    }
};

module.exports = { demanderChangement, listerDemandes, traiterDemande, reaffecterDemande };