import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type } from '@google/genai';
import dotenv from 'dotenv';
import fs from 'fs';

// Load environment variables
dotenv.config();

const PORT = 3000;

interface ReplaceRule {
  find: string;
  replace: string;
}

interface AdminConfig {
  adminEmail: string;
  allowedEmails: string[];
  replaceKeywords: ReplaceRule[];
  notionApiKey: string;
  notionParentPageId: string;
  geminiApiKey: string;
}

const CONFIG_PATH = path.join(process.cwd(), 'config.json');

function loadConfig(): AdminConfig {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const data = fs.readFileSync(CONFIG_PATH, 'utf-8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error('Failed to load admin config:', err);
  }
  return {
    adminEmail: '',
    allowedEmails: [],
    replaceKeywords: [],
    notionApiKey: '',
    notionParentPageId: '',
    geminiApiKey: '',
  };
}

function saveConfig(configData: AdminConfig) {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(configData, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to save admin config:', err);
  }
}

let adminConfig = loadConfig();

// Helper to get dynamically initialized Gemini Client
function getAiClient() {
  const apiKey = (adminConfig.geminiApiKey || process.env.GEMINI_API_KEY || '').trim();
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

interface DocElement {
  type: 'title' | 'heading_1' | 'heading_2' | 'heading_3' | 'paragraph' | 'bulleted_list_item';
  text: string;
}

/**
 * Extracts Google Document ID from various URL formats or returns raw ID
 */
function extractDocId(urlOrId: string): string {
  if (!urlOrId) return '';
  const match = urlOrId.match(/\/document\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : urlOrId.trim();
}

/**
 * Parses Notion Page/Database ID from URL or returns raw ID
 */
function extractNotionId(urlOrId: string): string {
  if (!urlOrId) return '';
  const cleaned = urlOrId.trim();
  // Extract 32-hex character string
  const match = cleaned.match(/[a-fA-F0-9]{32}/);
  if (match) return match[0];
  
  // Try extracting 8-4-4-4-12 pattern
  const hyphenMatch = cleaned.match(/[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}/);
  return hyphenMatch ? hyphenMatch[0] : cleaned;
}

/**
 * Parses Google Docs structural elements into simple array of items
 */
function parseGoogleDoc(docJson: any): DocElement[] {
  const elements: DocElement[] = [];
  if (!docJson || !docJson.body || !docJson.body.content) return elements;

  for (const item of docJson.body.content) {
    if (item.paragraph) {
      const p = item.paragraph;
      const text = (p.elements || [])
        .map((el: any) => (el.textRun ? el.textRun.content : ''))
        .join('')
        .replace(/\n+$/, '') // Remove trailing newlines
        .trim();

      if (!text) continue;

      let type: DocElement['type'] = 'paragraph';
      const styleType = p.paragraphStyle?.namedStyleType;
      
      if (styleType === 'TITLE') {
        type = 'title';
      } else if (styleType === 'HEADING_1') {
        type = 'heading_1';
      } else if (styleType === 'HEADING_2') {
        type = 'heading_2';
      } else if (styleType === 'HEADING_3') {
        type = 'heading_3';
      } else if (p.bullet) {
        type = 'bulleted_list_item';
      }

      elements.push({ type, text });
    }
  }
  return elements;
}

async function startServer() {
  const app = express();
  app.use(express.json());

  // 1. Auth Status check - registers first logged in user as admin, checks permissions
  app.post('/api/auth/status', (req, res) => {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, error: 'Email is required' });
    }

    const lowerEmail = email.toLowerCase().trim();

    // If there is no admin email registered yet, set this user as admin
    if (!adminConfig.adminEmail) {
      adminConfig.adminEmail = lowerEmail;
      saveConfig(adminConfig);
      console.log(`[Admin] Set first login user as admin: ${lowerEmail}`);
      return res.json({
        success: true,
        isAdmin: true,
        isAllowed: true,
        adminEmail: adminConfig.adminEmail,
        message: 'You have been set as the website administrator.',
      });
    }

    const isAdmin = lowerEmail === adminConfig.adminEmail.toLowerCase().trim();
    
    // Check if user is allowed: they are admin, OR their email is explicitly listed in allowedEmails
    const isAllowed = isAdmin || adminConfig.allowedEmails.some(
      (e) => e.toLowerCase().trim() === lowerEmail
    );

    res.json({
      success: true,
      isAdmin,
      isAllowed,
      adminEmail: adminConfig.adminEmail,
    });
  });

  // 2. Retrieve Admin Config (only allowed for Admin)
  app.get('/api/admin/config', (req, res) => {
    const userEmail = (req.headers['x-user-email'] as string || '').toLowerCase().trim();
    if (!userEmail || userEmail !== adminConfig.adminEmail.toLowerCase().trim()) {
      return res.status(403).json({ success: false, error: 'Access denied. Administrator privileges required.' });
    }

    res.json({
      success: true,
      config: {
        adminEmail: adminConfig.adminEmail,
        allowedEmails: adminConfig.allowedEmails,
        replaceKeywords: adminConfig.replaceKeywords,
        notionApiKey: adminConfig.notionApiKey,
        notionParentPageId: adminConfig.notionParentPageId,
        geminiApiKey: adminConfig.geminiApiKey,
      },
    });
  });

  // 3. Update Admin Config (only allowed for Admin)
  app.post('/api/admin/config', (req, res) => {
    const userEmail = (req.headers['x-user-email'] as string || '').toLowerCase().trim();
    if (!userEmail || userEmail !== adminConfig.adminEmail.toLowerCase().trim()) {
      return res.status(403).json({ success: false, error: 'Access denied. Administrator privileges required.' });
    }

    const { allowedEmails, replaceKeywords, notionApiKey, notionParentPageId, geminiApiKey } = req.body;

    if (Array.isArray(allowedEmails)) {
      adminConfig.allowedEmails = allowedEmails.map((e) => e.toLowerCase().trim()).filter(Boolean);
    }
    if (Array.isArray(replaceKeywords)) {
      adminConfig.replaceKeywords = replaceKeywords.filter((rule) => rule && typeof rule.find === 'string');
    }
    if (typeof notionApiKey === 'string') {
      adminConfig.notionApiKey = notionApiKey.trim();
    }
    if (typeof notionParentPageId === 'string') {
      adminConfig.notionParentPageId = notionParentPageId.trim();
    }
    if (typeof geminiApiKey === 'string') {
      adminConfig.geminiApiKey = geminiApiKey.trim();
    }

    saveConfig(adminConfig);
    console.log('[Admin] Admin configuration updated by', userEmail);

    res.json({
      success: true,
      config: adminConfig,
    });
  });

  // 4. Get Notion Configuration Status
  app.get('/api/notion/status', (req, res) => {
    const hasApiKey = !!(adminConfig.notionApiKey || process.env.NOTION_API_KEY);
    const hasParentPageId = !!(adminConfig.notionParentPageId || process.env.NOTION_PARENT_PAGE_ID);
    res.json({
      isConfigured: hasApiKey && hasParentPageId,
      hasApiKey,
      hasParentPageId,
    });
  });

  // 2. Main ETL Pipeline Handler
  app.post('/api/pipeline/run', async (req, res) => {
    try {
      const {
        googleDocUrl,
        googleToken,
        notionApiKey: overrideApiKey,
        notionParentId: overrideParentId,
        pipelineOptions,
      } = req.body;

      const userEmail = (req.headers['x-user-email'] as string || '').toLowerCase().trim();
      if (!userEmail) {
        return res.status(401).json({ success: false, error: 'User email is required. Please sign in to Google.' });
      }

      const isUserAdmin = userEmail === adminConfig.adminEmail.toLowerCase().trim();
      const isUserAllowed = isUserAdmin || adminConfig.allowedEmails.some(
        (e) => e.toLowerCase().trim() === userEmail
      );

      if (!isUserAllowed) {
        return res.status(403).json({ success: false, error: 'Access denied. You are not authorized to run this pipeline. Please contact the administrator.' });
      }

      if (!googleDocUrl) {
        return res.status(400).json({ success: false, error: 'Google Doc URL or ID is required.' });
      }
      if (!googleToken) {
        return res.status(401).json({ success: false, error: 'Google Access Token is required.' });
      }

      // Determine Notion credentials
      const notionKey = (adminConfig.notionApiKey || overrideApiKey || process.env.NOTION_API_KEY || '').trim();
      const notionParent = extractNotionId((adminConfig.notionParentPageId || overrideParentId || process.env.NOTION_PARENT_PAGE_ID || '').trim());

      if (!notionKey) {
        return res.status(400).json({ success: false, error: 'Notion API Key is required (administrator must configure it).' });
      }
      if (!notionParent) {
        return res.status(400).json({ success: false, error: 'Notion Parent Page ID is required.' });
      }

      const docId = extractDocId(googleDocUrl);
      if (!docId) {
        return res.status(400).json({ success: false, error: 'Could not parse a valid Google Doc ID from the provided input.' });
      }

      console.log(`[ETL] Starting pipeline for Doc: ${docId}, Notion Parent: ${notionParent}, Initiated by: ${userEmail}`);

      // =======================================================================
      // STEP 1: EXTRACT
      // =======================================================================
      let docJson: any;
      try {
        const docRes = await fetch(`https://docs.googleapis.com/v1/documents/${docId}`, {
          headers: { Authorization: `Bearer ${googleToken}` },
        });

        if (!docRes.ok) {
          const errMsgText = await docRes.text();
          let customErrorMessage = errMsgText;
          try {
            const parsedError = JSON.parse(errMsgText);
            const errDetails = parsedError.error;
            if (errDetails) {
              const msg = errDetails.message || '';
              if (msg.includes('disabled') || msg.includes('not been used in project') || msg.includes('SERVICE_DISABLED')) {
                customErrorMessage = 'Google Docs API is not enabled in your Google Cloud Project. Please open your Google Cloud Console (https://console.cloud.google.com/apis/library/docs.googleapis.com), enable "Google Docs API", and then try again.';
              } else if (errDetails.status === 'PERMISSION_DENIED' || msg.toLowerCase().includes('permission') || msg.toLowerCase().includes('caller does not have')) {
                customErrorMessage = 'Permission Denied to access this Google Doc. Please make sure the document is accessible by the Google Account you signed in with, or set the Doc to "Anyone with the link can view".';
              } else if (msg.toLowerCase().includes('office file') || msg.toLowerCase().includes('must not be an office file') || msg.toLowerCase().includes('not supported for this document')) {
                customErrorMessage = 'This document is currently saved in an Office format (such as .docx). Google Docs API only supports native Google Documents. To fix this: \n1. Open the file in Google Drive.\n2. Click "File" (top-left menu) and select "Save as Google Docs".\n3. Use the newly created Google Doc URL in DocsToNotion ETL.';
              } else {
                customErrorMessage = msg || errMsgText;
              }
            }
          } catch (e) {
            // Fallback to text
          }
          throw new Error(`Google Docs API returned status ${docRes.status}: ${customErrorMessage}`);
        }
        docJson = await docRes.json();
      } catch (err: any) {
        console.error('[ETL Error - Extract]', err);
        return res.status(400).json({
          success: false,
          error: `Extraction failed: ${err.message}`,
        });
      }

      const title = docJson.title || 'Untitled Google Doc';
      const parsedElements = parseGoogleDoc(docJson);

      if (parsedElements.length === 0) {
        return res.status(422).json({
          success: false,
          error: 'The extracted Google Doc has no text or paragraphs to process.',
        });
      }

      // Count words
      const fullText = parsedElements.map((el) => el.text).join('\n');
      const originalWordCount = fullText.split(/\s+/).filter(Boolean).length;

      // =======================================================================
      // STEP 2: TRANSFORM
      // =======================================================================
      let transformedElements: DocElement[] = [...parsedElements];
      let summaryText = '';
      let keywords: string[] = [];

      // Apply Admin-configured keyword replacements (e.g., "[footnote]" to "[reference]")
      if (adminConfig.replaceKeywords && adminConfig.replaceKeywords.length > 0) {
        console.log(`[ETL] Applying ${adminConfig.replaceKeywords.length} keyword replacement rules.`);
        transformedElements = transformedElements.map((el) => {
          let updatedText = el.text;
          for (const rule of adminConfig.replaceKeywords) {
            if (rule.find) {
              updatedText = updatedText.split(rule.find).join(rule.replace || '');
            }
          }
          return { ...el, text: updatedText };
        });
      }

      // If user wants standard cleaning, do a fast pre-pass on server
      if (pipelineOptions.cleanText) {
        transformedElements = transformedElements.map((el) => ({
          ...el,
          text: el.text
            .replace(/ {2,}/g, ' ') // Collapse multiple spaces
            .replace(/“/g, '"')
            .replace(/”/g, '"')
            .replace(/‘/g, "'")
            .replace(/’/g, "'"),
        }));
      }

      // Check if we need Gemini transform (translation, tone adjustments, summaries, etc.)
      const needsAiTransform =
        pipelineOptions.translateLanguage ||
        pipelineOptions.toneAdjust ||
        pipelineOptions.aiSummarize ||
        pipelineOptions.aiKeywords;

      if (needsAiTransform) {
        try {
          // If translation or tone adjustment is active, rewrite elements using Gemini
          if (pipelineOptions.translateLanguage || pipelineOptions.toneAdjust) {
            console.log(`[ETL - AI Transform] Language: ${pipelineOptions.translateLanguage}, Tone: ${pipelineOptions.toneAdjust}`);
            
            const prompt = `You are a master document editor and translator. Your task is to clean, translate, and adjust the tone of the provided document elements.
Input elements is a JSON array of objects, where each object has:
- "type": "title" | "heading_1" | "heading_2" | "heading_3" | "paragraph" | "bulleted_list_item"
- "text": string (the text content to transform)

Transform rules to apply:
1. Standardize spacing, fix obvious spelling and grammar errors.
${pipelineOptions.translateLanguage ? `2. Translate ALL text content into ${pipelineOptions.translateLanguage} language.` : '2. Keep the original language.'}
${pipelineOptions.toneAdjust ? `3. Adjust the tone of the text to be strictly "${pipelineOptions.toneAdjust}" (e.g. professional, casual, concise, etc.).` : '3. Preserve the original writing tone.'}
4. Maintain the exact same "type" field for each element. Do not merge, duplicate or omit any element.
5. Return the transformed result in a JSON array matching the exact structure of the input.

Input elements:
${JSON.stringify(transformedElements, null, 2)}
`;

            const aiRes = await getAiClient().models.generateContent({
              model: 'gemini-3.5-flash',
              contents: prompt,
              config: {
                responseMimeType: 'application/json',
                responseSchema: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      type: { type: Type.STRING, description: "Structure type" },
                      text: { type: Type.STRING, description: "Transformed text content" },
                    },
                    required: ['type', 'text'],
                  },
                },
              },
            });

            if (aiRes.text) {
              const cleanedText = aiRes.text.trim();
              transformedElements = JSON.parse(cleanedText);
            }
          }

          const combinedText = transformedElements.map((el) => el.text).join('\n');

          // Generate AI Summary if requested
          if (pipelineOptions.aiSummarize) {
            console.log('[ETL - AI Summary] Generating TL;DR...');
            const summaryPrompt = `Analyze the following document and provide a concise "TL;DR Key Takeaways" summary as a list of bullet points. Keep it highly readable and compact (max 3 bullet points, no extra text):\n\n${combinedText}`;
            const summaryRes = await getAiClient().models.generateContent({
              model: 'gemini-3.5-flash',
              contents: summaryPrompt,
            });
            summaryText = summaryRes.text || '';
          }

          // Extract AI Keywords if requested
          if (pipelineOptions.aiKeywords) {
            console.log('[ETL - AI Keywords] Extracting keywords...');
            const keywordsPrompt = `Analyze the following document and extract 3 to 6 highly relevant, single-word keywords or short descriptive tags that classify this document's topic. Return only a JSON list of strings:\n\n${combinedText}`;
            const keywordsRes = await getAiClient().models.generateContent({
              model: 'gemini-3.5-flash',
              contents: keywordsPrompt,
              config: {
                responseMimeType: 'application/json',
                responseSchema: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
              },
            });
            if (keywordsRes.text) {
              keywords = JSON.parse(keywordsRes.text.trim());
            }
          }
        } catch (aiErr: any) {
          console.error('[ETL Warning - AI Transform failed]', aiErr);
          // AI transformations failed but we can fallback to raw extracted text so we don't break the entire ETL process
          console.log('[ETL] Falling back to non-AI parsed elements due to AI transform failure.');
        }
      }

      const finalWordCount = transformedElements.map((el) => el.text).join('\n').split(/\s+/).filter(Boolean).length;

      // =======================================================================
      // STEP 3: LOAD (Notion integration)
      // =======================================================================
      const notionBlocks: any[] = [];

      // 1. Add AI Summary Callout at top if generated
      if (summaryText) {
        notionBlocks.push({
          object: 'block',
          type: 'callout',
          callout: {
            rich_text: [
              {
                type: 'text',
                text: { content: `💡 TL;DR - Key Takeaways:\n\n${summaryText.trim()}` },
              },
            ],
            icon: { emoji: '💡' },
            color: 'blue_background',
          },
        });
      }

      // 2. Add AI Keywords Quote Block if generated
      if (keywords && keywords.length > 0) {
        notionBlocks.push({
          object: 'block',
          type: 'quote',
          quote: {
            rich_text: [
              {
                type: 'text',
                text: { content: `🏷️ Tags: ${keywords.map((k) => `#${k.toLowerCase().replace(/\s+/g, '')}`).join(' ')}` },
              },
            ],
            color: 'gray',
          },
        });
        
        // Add divider for clean page separation
        notionBlocks.push({
          object: 'block',
          type: 'divider',
          divider: {},
        });
      }

      // Helper function to split text exceeding Notion's 2000 character limit
      const addTextBlocks = (type: string, text: string) => {
        const MAX_CHARS = 1800; // Safe threshold (limit is 2000)
        let cursor = 0;
        
        while (cursor < text.length) {
          const chunk = text.slice(cursor, cursor + MAX_CHARS);
          
          if (type === 'heading_1') {
            notionBlocks.push({
              object: 'block',
              type: 'heading_1',
              heading_1: { rich_text: [{ type: 'text', text: { content: chunk } }] },
            });
          } else if (type === 'heading_2') {
            notionBlocks.push({
              object: 'block',
              type: 'heading_2',
              heading_2: { rich_text: [{ type: 'text', text: { content: chunk } }] },
            });
          } else if (type === 'heading_3') {
            notionBlocks.push({
              object: 'block',
              type: 'heading_3',
              heading_3: { rich_text: [{ type: 'text', text: { content: chunk } }] },
            });
          } else if (type === 'bulleted_list_item') {
            notionBlocks.push({
              object: 'block',
              type: 'bulleted_list_item',
              bulleted_list_item: { rich_text: [{ type: 'text', text: { content: chunk } }] },
            });
          } else {
            notionBlocks.push({
              object: 'block',
              type: 'paragraph',
              paragraph: { rich_text: [{ type: 'text', text: { content: chunk } }] },
            });
          }
          
          cursor += MAX_CHARS;
        }
      };

      // Add actual document elements
      for (const el of transformedElements) {
        if (el.type === 'title') {
          // If title block is in elements, write it as heading_1
          addTextBlocks('heading_1', el.text);
        } else {
          addTextBlocks(el.type, el.text);
        }
      }

      // Create the Notion Page via official Notion API
      let notionPage: any;
      try {
        const notionRes = await fetch('https://api.notion.com/v1/pages', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${notionKey}`,
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            parent: { page_id: notionParent },
            properties: {
              title: {
                id: 'title',
                type: 'title',
                title: [
                  {
                    type: 'text',
                    text: { content: title },
                  },
                ],
              },
            },
            // Notion allows adding up to 100 blocks during initial creation
            children: notionBlocks.slice(0, 100),
          }),
        });

        if (!notionRes.ok) {
          const errMsg = await notionRes.text();
          throw new Error(`Notion API returned status ${notionRes.status}: ${errMsg}`);
        }
        notionPage = await notionRes.json();

        // If there are more than 100 blocks, append the rest using the patch blocks endpoint
        if (notionBlocks.length > 100) {
          console.log(`[ETL] Appending remaining ${notionBlocks.length - 100} blocks to Notion page: ${notionPage.id}`);
          const remainingBlocks = notionBlocks.slice(100);
          
          // Patch in chunks of 100 (Notion API max limit per request)
          for (let i = 0; i < remainingBlocks.length; i += 100) {
            const chunk = remainingBlocks.slice(i, i + 100);
            const patchRes = await fetch(`https://api.notion.com/v1/blocks/${notionPage.id}/children`, {
              method: 'PATCH',
              headers: {
                'Authorization': `Bearer ${notionKey}`,
                'Notion-Version': '2022-06-28',
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ children: chunk }),
            });
            if (!patchRes.ok) {
              const patchErrMsg = await patchRes.text();
              console.error(`[ETL Warning] Failed to append blocks chunk ${i}: ${patchErrMsg}`);
            }
          }
        }
      } catch (err: any) {
        console.error('[ETL Error - Load Notion]', err);
        return res.status(400).json({
          success: false,
          error: `Loading to Notion failed. Please verify that:
1. Your Notion API Key is correct.
2. The Parent Page ID exists and is accessible.
3. You have explicitly shared the parent page with your Notion integration as a "Connection".
Details: ${err.message}`,
        });
      }

      console.log(`[ETL] Page successfully created in Notion: ${notionPage.id}`);

      // Calculate estimated reading time
      const readingTimeMinutes = Math.max(1, Math.ceil(finalWordCount / 225));

      const responsePayload = {
        success: true,
        notionPageUrl: notionPage.url,
        notionPageId: notionPage.id,
        title,
        originalWordCount,
        finalWordCount,
        metadata: {
          summary: summaryText || undefined,
          keywords: keywords.length > 0 ? keywords : undefined,
          readingTime: `${readingTimeMinutes} min read`,
          processedAt: new Date().toLocaleString(),
        },
      };

      res.json(responsePayload);
    } catch (error: any) {
      console.error('[ETL Global Error]', error);
      res.status(500).json({
        success: false,
        error: `A server-side error occurred while processing the ETL pipeline. Details: ${error.message}`,
      });
    }
  });

  // Serve client assets in production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
