// Runes : structure d'une page et validation avant envoi au client (/lol-perks/v1).
// Ordre de selectedPerkIds : [clé de voûte, 3 runes principales, 2 runes secondaires, 3 fragments].

const plain = html => String(html || '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

// Réduit les arbres du client à ce dont l'éditeur a besoin.
function describeStyles(styles, perks) {
  const perkInfo = new Map((perks || []).map(perk => [perk.id, { id: perk.id, name: perk.name, iconPath: perk.iconPath, description: plain(perk.shortDesc || perk.longDesc) }]));
  return {
    styles: (styles || []).map(style => ({
      id: style.id, name: style.name, iconPath: style.iconPath,
      allowedSubStyles: style.allowedSubStyles || [],
      keystones: style.slots?.[0]?.perks || [],
      rows: (style.slots || []).filter(slot => slot.type === 'kMixedRegularSplashable').map(slot => slot.perks),
      shards: (style.slots || []).filter(slot => slot.type === 'kStatMod').map(slot => slot.perks)
    })),
    perks: Object.fromEntries(perkInfo)
  };
}

function validatePage(page, styles) {
  const primary = styles.find(style => style.id === page?.primaryStyleId);
  const secondary = styles.find(style => style.id === page?.subStyleId);
  const ids = page?.selectedPerkIds;
  if (!primary) throw new Error('Choisis un arbre principal.');
  if (!secondary || !primary.allowedSubStyles.includes(secondary.id)) throw new Error('Choisis un arbre secondaire différent.');
  if (!Array.isArray(ids) || ids.length !== 9 || !ids.every(Number.isInteger)) throw new Error('Page de runes incomplète.');
  if (!primary.keystones.includes(ids[0])) throw new Error('Choisis une clé de voûte.');
  primary.rows.forEach((row, index) => { if (!row.includes(ids[index + 1])) throw new Error(`Choisis une rune sur la ligne ${index + 2} de l’arbre principal.`); });
  const secondaryRows = [ids[4], ids[5]].map(id => secondary.rows.findIndex(row => row.includes(id)));
  if (secondaryRows.includes(-1)) throw new Error('Choisis deux runes dans l’arbre secondaire.');
  if (secondaryRows[0] === secondaryRows[1]) throw new Error('Les deux runes secondaires doivent être sur des lignes différentes.');
  primary.shards.forEach((row, index) => { if (!row.includes(ids[6 + index])) throw new Error('Choisis les trois fragments.'); });
  const name = String(page.name || '').trim().slice(0, 25) || 'Ward';
  return { name, primaryStyleId: primary.id, subStyleId: secondary.id, selectedPerkIds: ids };
}

// Page complète à partir d'une recommandation du client (champion, poste, carte).
function fromRecommendation(recommendation, name) {
  return { name, primaryStyleId: recommendation.primaryPerkStyleId, subStyleId: recommendation.secondaryPerkStyleId,
    selectedPerkIds: (recommendation.perks || []).map(perk => perk.id ?? perk) };
}

module.exports = { describeStyles, validatePage, fromRecommendation, plain };
