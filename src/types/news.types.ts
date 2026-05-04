export interface RssFeed {
  id: string;
  name: string;
  url: string;
  createdAt: string;
}

export interface NewsArticle {
  id: string;
  feedId: string;
  feedName: string;
  title: string;
  link: string;
  pubDate: string;
  contentSnippet: string;
  content: string;
  thumbnailUrl: string | null;
  categories: string[];
}
