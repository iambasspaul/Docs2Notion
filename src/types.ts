/**
 * Shared Types for the Google Docs to Notion ETL Pipeline
 */

export interface FirebaseAppletConfig {
  projectId: string;
  appId: string;
  apiKey: string;
  authDomain: string;
  storageBucket: string;
  messagingSenderId: string;
  measurementId?: string;
  oAuthClientId?: string;
}

export interface NotionConfigStatus {
  isConfigured: boolean;
  hasApiKey: boolean;
  hasParentPageId: boolean;
}

export interface PipelineOptions {
  cleanText: boolean;        // Remove double spaces, standardize typography
  aiSummarize: boolean;      // Generate a TL;DR key takeaways block at the top
  aiKeywords: boolean;       // Auto-generate tags and keywords
  translateLanguage?: string; // Translate content into "spanish", "french", "japanese", etc.
  toneAdjust?: string;        // "professional", "casual", "concise", "academic"
}

export interface PipelineStep {
  id: 'extract' | 'transform' | 'load';
  name: string;
  description: string;
  status: 'idle' | 'running' | 'completed' | 'failed';
  message: string;
}

export interface EtlResponse {
  success: boolean;
  notionPageUrl?: string;
  notionPageId?: string;
  title: string;
  originalWordCount: number;
  finalWordCount: number;
  metadata?: {
    summary?: string;
    keywords?: string[];
    sentiment?: string;
    readingTime?: string;
    processedAt: string;
  };
  error?: string;
}
