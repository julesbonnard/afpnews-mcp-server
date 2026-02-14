export const GENRE_EXCLUSIONS = {
  exclude: [
    'afpgenre:Agenda',
    'afpattribute:Agenda',
    'afpattribute:Program',
    'afpattribute:TextProgram',
    'afpattribute:AdvisoryUpdate',
    'afpattribute:Advice',
    'afpattribute:SpecialAnnouncement',
    'afpattribute:PictureProgram'
  ]
};

export function formatDocument(doc: any) {
  return {
    type: 'text' as const,
    uno: String(doc.uno),
    published: new Date(doc.published),
    title: String(doc.headline),
    text: String(doc.news.join('\n\n')).substring(0, 10000),
    lang: String(doc.lang),
    genre: String(doc.genre)
  };
}
