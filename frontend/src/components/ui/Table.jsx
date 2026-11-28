export default function Table({ colonnes, donnees, cleLigne = 'id', vide = 'Aucun élément à afficher.' }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50">
          <tr>
            {colonnes.map((c) => (
              <th key={c.cle} className="px-4 py-3 text-left font-semibold text-slate-600">
                {c.titre}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {donnees.length === 0 ? (
            <tr>
              <td colSpan={colonnes.length} className="px-4 py-10 text-center text-slate-500">
                {vide}
              </td>
            </tr>
          ) : (
            donnees.map((ligne) => (
              <tr key={ligne[cleLigne]} className="hover:bg-slate-50">
                {colonnes.map((c) => (
                  <td key={c.cle} className="px-4 py-3 text-slate-700">
                    {c.rendu ? c.rendu(ligne) : ligne[c.cle]}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}