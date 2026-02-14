export interface AFPDocument {
  uno: string;
  headline: string;
  published: string;
  lang: string;
  genre: string;
  news: string[];
  status?: string;
  signal?: string;
  advisory?: string;
}

export interface FormattedContent {
  type: 'text';
  text: string;
}
