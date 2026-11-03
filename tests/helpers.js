'use strict';

let counter = 0;

// Deux entrées de même `title` partagent le même `card_id` : elles forment un groupe
// (donc un doublon, si leur `shiny` est identique). Pour deux cartes distinctes,
// donner des titres différents ou un `cardId` explicite.
function makeEntry({
  id = `e${++counter}`,
  cardId,
  title = 'Titre',
  category = 'catégorie',
  rarity = 'C',
  count = 1,
  shiny = false,
  starred = false,
  tags = [],
  obtainedAt = '2026-11-01T00:00:00+00:00',
} = {}) {
  const card_id = cardId ?? `card-${title}`;
  return {
    id,
    card: {
      id: card_id,
      atk: 1000,
      def: 1000,
      lang: 'fr',
      rarity,
      q_score: 10,
      category,
      image_url: `https://example.test/${encodeURIComponent(title)}.png`,
      pageviews: 1000,
      created_at: '2026-01-01T00:00:00+00:00',
      hide_image: false,
      wikipedia_url: `https://fr.wikipedia.org/wiki/${encodeURIComponent(title)}`,
      wikipedia_title: title,
    },
    tags,
    count,
    card_id,
    starred,
    user_id: 'user-A',
    is_shiny: shiny,
    obtained_at: obtainedAt,
  };
}

module.exports = { makeEntry };
