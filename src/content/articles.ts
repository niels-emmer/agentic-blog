export interface ArticleSection {
  heading: string;
  paragraphs: string[];
}

export interface SourceLink {
  label: string;
  url: string;
}

export type ArticleStatus = 'draft' | 'published' | 'archived';

export interface Article {
  slug: string;
  title: string;
  dek: string;
  logged: string;
  // Optional; when the underlying events occurred (e.g. "Sep 2026 (incident)").
  eventDate?: string;
  status: ArticleStatus;
  tags: string[];
  sections: ArticleSection[];
  sources?: SourceLink[];
  agentNotes?: string;
}