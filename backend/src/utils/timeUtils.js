const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

const getJourFromDate = (dateStr) => JOURS[new Date(`${dateStr}T12:00:00`).getDay()];

const checkTimeOverlap = (c1, c2) => {
    if (!c1.heure_debut || !c2.heure_debut) return true;
    return c1.heure_debut < c2.heure_fin && c1.heure_fin > c2.heure_debut;
};

const checkDateOverlap = (c1, c2, edt1, edt2) => {
    if (edt1.date_fin < edt2.date_debut || edt1.date_debut > edt2.date_fin) return false;

    if (c1.date_creneau && c2.date_creneau) return c1.date_creneau === c2.date_creneau;

    if (c1.date_creneau && !c2.date_creneau) {
        if (c1.date_creneau < edt2.date_debut || c1.date_creneau > edt2.date_fin) return false;
        return getJourFromDate(c1.date_creneau) === c2.jour;
    }
    if (!c1.date_creneau && c2.date_creneau) {
        if (c2.date_creneau < edt1.date_debut || c2.date_creneau > edt1.date_fin) return false;
        return getJourFromDate(c2.date_creneau) === c1.jour;
    }
    return c1.jour === c2.jour;
};

// Date du jour (heure locale) au format YYYY-MM-DD
const aujourdHui = () => new Date().toLocaleDateString('fr-CA');

// Vrai si la chaîne est une vraie date calendaire au format YYYY-MM-DD (refuse 2026-02-30, "abc"...)
const estDateValide = (s) => {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const d = new Date(`${s}T12:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

module.exports = { checkTimeOverlap, checkDateOverlap, getJourFromDate, aujourdHui, estDateValide };