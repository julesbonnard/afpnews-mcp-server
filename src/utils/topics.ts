export interface Topic {
  label: string;
  value: string;
}

export const TOPICS: Record<string, Topic[]> = {
  fr: [
    { label: "A la une", value: "ONLINE-NEWS-FR_LA-UNE" },
    { label: "Monde", value: "ONLINE-NEWS-FR_MONDE" },
    { label: "France", value: "ONLINE-NEWS-FR_FRANCE" },
    { label: "Politique", value: "ONLINE-NEWS-FR_POLITIQUE" },
    { label: "Economie/Finances", value: "ONLINE-NEWS-FR_ECONOMIE-FINANCES" },
    { label: "Fil éco", value: "service-eco-fr" },
    { label: "Sport", value: "ONLINE-NEWS-FR_SPORT" },
    { label: "Planète", value: "ONLINE-NEWS-FR_ENVIRONNEMENT" },
    { label: "Société", value: "ONLINE-NEWS-FR_SOCIETE-MODE-VIE" },
    { label: "Tech-Media", value: "ONLINE-NEWS-FR_HIGHTECH" },
    { label: "Santé", value: "ONLINE-NEWS-FR_MEDECINE-SANTE" },
    { label: "Culture", value: "ONLINE-NEWS-FR_CULTURE-ART-VIVRE" },
    { label: "Sciences", value: "ONLINE-NEWS-FR_SCIENCES" },
    { label: "Afrique", value: "ONLINE-NEWS-FR_AFRIQUE" },
    { label: "Football", value: "ONLINE-NEWS-FR_FOOTBALL" },
    { label: "Insolite", value: "ONLINE-NEWS-FR_INSOLITE" },
    { label: "People", value: "ONLINE-NEWS-FR_PEOPLE" },
    { label: "Faits divers", value: "ONLINE-NEWS-FR_FAITS-DIVERS" },
    { label: "Galeries Photos", value: "ONLINE-NEWS-FR_PHO-GAL" },
  ],
  en: [
    { label: "Top Stories", value: "ONLINE-NEWS-EN_TOP-STORIES-INT" },
    { label: "International News", value: "ONLINE-NEWS-EN_INTERNATIONAL" },
    { label: "Business and Tech", value: "ONLINE-NEWS-EN_BUSINESS-TECH" },
    { label: "Science and Environment", value: "ONLINE-NEWS-EN_SCIENCE-ENVIRONMENT" },
    { label: "Sports", value: "ONLINE-NEWS-EN_SPORTS" },
    { label: "Health and Lifestyle", value: "ONLINE-NEWS-EN_HEALTH-LIFESTYLE" },
    { label: "Football", value: "ONLINE-NEWS-EN_FOOTBALL" },
    { label: "Cricket", value: "ONLINE-NEWS-EN_CRICKET" },
    { label: "Offbeat", value: "ONLINE-NEWS-EN_OFFBEAT" },
    { label: "Entertainment", value: "ONLINE-NEWS-EN_PEOPLE-ENTERTAINMENT" },
    { label: "Africa", value: "ONLINE-NEWS-EN_AFRICA" },
    { label: "Asia Pacific News", value: "ONLINE-NEWS-EN_ASIAPAC-NEWS" },
    { label: "Asia Business", value: "ONLINE-NEWS-EN_ASIA-BUSINESS" },
    { label: "Canada", value: "ONLINE-NEWS-EN_CANADA" },
    { label: "Middle East", value: "ONLINE-NEWS-EN_MIDDLE-EAST" },
    { label: "South Asia Top Stories", value: "ONLINE-NEWS-EN_TOP-STORIES-SA" },
    { label: "US News", value: "ONLINE-NEWS-EN_US-NEWS" },
    { label: "US Politics", value: "ONLINE-NEWS-EN_US-POLITICS" },
    { label: "US Sports", value: "ONLINE-NEWS-EN_US-SPORTS" },
    { label: "UK News", value: "ONLINE-NEWS-EN_UK-NEWS" },
    { label: "Photo Gallery", value: "ONLINE-NEWS-EN_PHO-GAL-US" },
  ],
  de: [
    { label: "Topthemen", value: "ONLINE-NEWS-DE_TOPTHEMEN" },
    { label: "Wirtschaft", value: "ONLINE-NEWS-DE_WIRTSCHAFT" },
    { label: "Deutschland", value: "ONLINE-NEWS-DE_DEUTSCHLAND" },
    { label: "Weltgeschehen", value: "ONLINE-NEWS-DE_WELTGESCHEHEN" },
    { label: "Politik", value: "ONLINE-NEWS-DE_POLITIK" },
    { label: "Panorama", value: "ONLINE-NEWS-DE_PANORAMA" },
    { label: "Umwelt", value: "ONLINE-NEWS-DE_UMWELT" },
    { label: "Tiere", value: "ONLINE-NEWS-DE_TIERE" },
    { label: "Kurioses", value: "ONLINE-NEWS-DE_KURIOSES" },
    { label: "Leute", value: "ONLINE-NEWS-DE_LEUTE" },
    { label: "Unterhaltung", value: "ONLINE-NEWS-DE_UNTERHALTUNG" },
    { label: "Neu Im Kino", value: "ONLINE-NEWS-DE_NEU-IM-KINO" },
    { label: "Telekommunikation", value: "ONLINE-NEWS-DE_TELEKOM" },
    { label: "Gesundheit/Medizin", value: "ONLINE-NEWS-DE_GESUNDHEIT-MEDIZIN" },
    { label: "Verbraucher", value: "ONLINE-NEWS-DE_VERBRAUCHER" },
    { label: "Justiz", value: "ONLINE-NEWS-DE_JUSTIZ" },
    { label: "Steuer", value: "ONLINE-NEWS-DE_STEUER" },
    { label: "Arbeit", value: "ONLINE-NEWS-DE_ARBEIT" },
    { label: "Wissenschaft/Technik", value: "ONLINE-NEWS-DE_WISSENSCHAFT-TECHNIK" },
    { label: "Kommentar", value: "ONLINE-NEWS-DE_KOMMENTAR" },
    { label: "Bildergalerie", value: "ONLINE-NEWS-DE_BILDERGALERIE" },
    { label: "Wirtschaft Ticker", value: "ONLINE-NEWS-DE_WIRTSCHAFT-TICKER" },
    { label: "Politik Ticker", value: "ONLINE-NEWS-DE_POLITIK-TICKER" },
    { label: "Newsticker", value: "ONLINE-NEWS-DE_NEWSTICKER" },
    { label: "Vermischtes Ticker", value: "ONLINE-NEWS-DE_VERMISCHTES-TICKER" },
  ],
  pt: [
    { label: "Mundo", value: "ONLINE-NEWS-PT_MUNDO" },
    { label: "América Latina", value: "ONLINE-NEWS-PT_AMERICA-LATINA" },
    { label: "Economia", value: "ONLINE-NEWS-PT_ECONOMIA" },
    { label: "Sociedade", value: "ONLINE-NEWS-PT_SOCIEDADE" },
    { label: "Esporte", value: "ONLINE-NEWS-PT_ESPORTE" },
    { label: "Arte e Cultura", value: "ONLINE-NEWS-PT_ARTE-E-CULTURA" },
    { label: "Ciência e Tecnologia", value: "ONLINE-NEWS-PT_CIENCIA-E-TECNOLOGIA" },
    { label: "Meio Ambiente", value: "ONLINE-NEWS-PT_MEIO-AMBIENTE" },
    { label: "Eleições", value: "ONLINE-NEWS-PT_ELEICOES" },
    { label: "Profundidade", value: "ONLINE-NEWS-PT_PROFUNDIDADE" },
    { label: "Galeria de Fotos", value: "ONLINE-NEWS-PT_GALERIA-DE-FOTOS" },
  ],
  es: [
    { label: "Mundo", value: "ONLINE-NEWS-ES_MUNDO" },
    { label: "Latinoamérica", value: "ONLINE-NEWS-ES_LATINOAMERICA" },
    { label: "España", value: "ONLINE-NEWS-ES_ESPANA" },
    { label: "Medioambiente", value: "ONLINE-NEWS-ES_MEDIOAMBIENTE" },
    { label: "Portada", value: "ONLINE-NEWS-ES_PORTADA" },
    { label: "Economía", value: "ONLINE-NEWS-ES_MADRID-ECO" },
    { label: "Cultura", value: "ONLINE-NEWS-ES_CULTURA" },
    { label: "Gente", value: "ONLINE-NEWS-ES_GENTE" },
    { label: "Ciencia y Tecnología", value: "ONLINE-NEWS-ES_CIENCIA-Y-TECNOLOGIA" },
    { label: "Nuevas Tecnologías", value: "ONLINE-NEWS-ES_NUEVAS-TECNO" },
    { label: "Insólito", value: "ONLINE-NEWS-ES_INSOLITO" },
    { label: "Sociedad", value: "ONLINE-NEWS-ES_SOCIEDAD" },
    { label: "Deportes", value: "ONLINE-NEWS-ES_MADRID-DEPORTES" },
    { label: "Lo último del fútbol", value: "ONLINE-NEWS-ES_ULTIMO-FUTBOL" },
    { label: "Campeonatos", value: "ONLINE-NEWS-ES_CAMPEONATOS" },
    { label: "Clasificaciones y resultados", value: "ONLINE-NEWS-ES_CLASIFICACIONES" },
    { label: "Fútbol", value: "ONLINE-NEWS-ES_FUTBOL" },
    { label: "Día en Imágenes", value: "ONLINE-NEWS-ES_DIA-EN-IMAGENES" },
    { label: "Galería de fotos", value: "ONLINE-NEWS-ES_PHO-GAL-FUTBOL" },
    { label: "Reportajes Especiales", value: "ONLINE-NEWS-ES_REPORTAJES-ESPEC" },
  ],
  ar: [
    { label: "ابرز الاخبار", value: "ONLINE-NEWS-AR_TOP-STORIES" },
    { label: "اخبار دولية", value: "ONLINE-NEWS-AR_MONDE" },
    { label: "اخبار الامارات", value: "ONLINE-NEWS-AR_EMIRATES-AU" },
    { label: "الشرق الاوسط", value: "ONLINE-NEWS-AR_MOYEN-ORIENT" },
    { label: "اقتصاد", value: "ONLINE-NEWS-AR_ECONOMY" },
    { label: "رياضة", value: "ONLINE-NEWS-AR_SPORTS" },
    { label: "عاجل", value: "ONLINE-NEWS-AR_URGENTS" },
    { label: "من الدنيا", value: "ONLINE-NEWS-AR_MINAL-DOUNIA" },
    { label: "معرض الصور", value: "ONLINE-NEWS-AR_PHO-GAL" },
  ],
};

export function getTopicLabel(value: string): string | undefined {
  for (const topics of Object.values(TOPICS)) {
    const topic = topics.find(t => t.value === value);
    if (topic) return topic.label;
  }
  return undefined;
}

export function formatTopicList(): string {
  return Object.entries(TOPICS)
    .map(([lang, topics]) =>
      `${lang}: ${topics.map(t => `${t.label} (${t.value})`).join(', ')}`
    )
    .join('\n');
}
