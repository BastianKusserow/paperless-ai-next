// services/promptTemplateService.js
const fs = require('fs');
const path = require('path');
const { Liquid } = require('liquidjs');
const { format } = require('date-fns');

const PROMPTS_DEFAULTS_DIR = path.join(process.cwd(), 'prompts', 'defaults');
const PROMPTS_OVERRIDE_DIR = path.join(process.cwd(), 'data', 'prompts');

const PROMPT_REGISTRY = [
  {
    id: 'rag.query_rewrite',
    title: 'RAG Query Rewrite',
    description: 'Rewrites user questions and extracts metadata filters for document retrieval.',
    category: 'RAG',
    defaultFilename: 'rag-query-rewrite.tmpl',
    responseMode: 'json',
    supportsPreview: true,
    variables: [
      'context.question',
      'context.conversationHistory',
      'context.currentDate',
      'context.currentDateTime',
      'context.languageHint',
      'context.uiFilters',
      'context.effectiveFiltersJson',
      'context.supportedFilters'
    ]
  },
  {
    id: 'rag.answer_lightweight',
    title: 'RAG Answer Generation (Lightweight)',
    description: 'Generates answers from retrieved snippets and metadata.',
    category: 'RAG',
    defaultFilename: 'rag-answer-lightweight.tmpl',
    responseMode: 'freeform',
    supportsPreview: true,
    variables: [
      'context.question',
      'context.conversationHistory',
      'context.currentDate',
      'context.currentDateTime',
      'context.languageHint',
      'context.effectiveFilters',
      'context.sources'
    ]
  },
  {
    id: 'rag.answer_plan',
    title: 'RAG Answer Planner',
    description: 'Plans whether deeper evidence is required before generating an answer.',
    category: 'RAG',
    defaultFilename: 'rag-answer-plan.tmpl',
    responseMode: 'json',
    supportsPreview: true,
    variables: [
      'context.question',
      'context.conversationHistory',
      'context.currentDate',
      'context.currentDateTime',
      'context.languageHint',
      'context.effectiveFilters',
      'context.sources'
    ]
  },
  {
    id: 'rag.answer_final',
    title: 'RAG Answer Generation (Deep Evidence)',
    description: 'Generates final answers from selected full documents with citations.',
    category: 'RAG',
    defaultFilename: 'rag-answer-final.tmpl',
    responseMode: 'freeform',
    supportsPreview: true,
    variables: [
      'context.question',
      'context.conversationHistory',
      'context.currentDate',
      'context.currentDateTime',
      'context.languageHint',
      'context.effectiveFilters',
      'context.sources',
      'context.documents',
      'context.documentsXml'
    ]
  },
  {
    id: 'document.analysis.body',
    title: 'Document Analysis (Body)',
    description: 'Task instructions for AI document metadata extraction.',
    category: 'Document Analysis',
    defaultFilename: 'document-analysis-body.tmpl',
    responseMode: 'system',
    supportsPreview: true,
    variables: [
      'context.currentDate',
      'context.languageHint'
    ]
  },
  {
    id: 'document.analysis.schema',
    title: 'Document Analysis (Schema)',
    description: 'JSON output format guidance for document metadata extraction.',
    category: 'Document Analysis',
    defaultFilename: 'document-analysis-schema.tmpl',
    responseMode: 'schema',
    supportsPreview: true,
    variables: [
      'context.customFieldsSchema',
      'context.customFieldsDefinitions'
    ]
  },
  {
    id: 'document.analysis.predefined_tags',
    title: 'Document Analysis (Predefined Tags)',
    description: 'Variant of document analysis with restricted tag vocabulary.',
    category: 'Document Analysis',
    defaultFilename: 'document-analysis-predefined-tags.tmpl',
    responseMode: 'json',
    supportsPreview: true,
    variables: [
      'context.allowedTags',
      'context.currentDate'
    ]
  },
  {
    id: 'chat.document.system',
    title: 'Document Chat (System)',
    description: 'System prompt for document-focused chat interactions.',
    category: 'Chat',
    defaultFilename: 'document-chat-system.tmpl',
    responseMode: 'system',
    supportsPreview: true,
    variables: [
      'context.documentTitle',
      'context.documentCreated',
      'context.documentCorrespondent',
      'context.question',
      'context.currentDate'
    ]
  },
  {
    id: 'playground.analysis.schema',
    title: 'Playground Analysis (Schema)',
    description: 'JSON output format for playground document analysis.',
    category: 'Playground',
    defaultFilename: 'playground-analysis-schema.tmpl',
    responseMode: 'schema',
    supportsPreview: true,
    variables: []
  },
  {
    id: 'text.generation.system',
    title: 'Text Generation (System)',
    description: 'Generic system prompt for freeform text generation.',
    category: 'General',
    defaultFilename: 'text-generation-system.tmpl',
    responseMode: 'system',
    supportsPreview: true,
    variables: [
      'context.currentDate'
    ]
  }
];

class PromptTemplateService {
  constructor() {
    this.engine = new Liquid({
      strictFilters: false,
      strictVariables: false,
      greedy: false,
      dateFormat: 'yyyy-MM-dd',
      timezones: ['local']
    });

    this.cache = new Map();
    this.cacheMtime = new Map();

    this.ensureOverrideDir();
    this.initMtimeTracking();
  }

  ensureOverrideDir() {
    if (!fs.existsSync(PROMPTS_OVERRIDE_DIR)) {
      fs.mkdirSync(PROMPTS_OVERRIDE_DIR, { recursive: true });
    }
  }

  initMtimeTracking() {
    for (const entry of PROMPT_REGISTRY) {
      const defaultPath = this.getDefaultPath(entry.defaultFilename);
      const overridePath = this.getOverridePath(entry.defaultFilename);

      if (fs.existsSync(defaultPath)) {
        try {
          this.cacheMtime.set(defaultPath, fs.statSync(defaultPath).mtimeMs);
        } catch (e) {
          console.warn(`[PromptTemplateService] Could not stat default template: ${defaultPath}`);
        }
      }
      if (fs.existsSync(overridePath)) {
        try {
          this.cacheMtime.set(overridePath, fs.statSync(overridePath).mtimeMs);
        } catch (e) {
          console.warn(`[PromptTemplateService] Could not stat override template: ${overridePath}`);
        }
      }
    }
  }

  getDefaultPath(filename) {
    return path.join(PROMPTS_DEFAULTS_DIR, filename);
  }

  getOverridePath(filename) {
    return path.join(PROMPTS_OVERRIDE_DIR, filename);
  }

  getTemplatePath(templateId) {
    const entry = PROMPT_REGISTRY.find(e => e.id === templateId);
    if (!entry) return null;

    const overridePath = this.getOverridePath(entry.defaultFilename);
    if (fs.existsSync(overridePath)) {
      return overridePath;
    }
    return this.getDefaultPath(entry.defaultFilename);
  }

  getTemplateContent(templateId) {
    const entry = PROMPT_REGISTRY.find(e => e.id === templateId);
    if (!entry) {
      throw new Error(`Unknown template ID: ${templateId}`);
    }

    const overridePath = this.getOverridePath(entry.defaultFilename);
    if (fs.existsSync(overridePath)) {
      return fs.readFileSync(overridePath, 'utf8');
    }

    const defaultPath = this.getDefaultPath(entry.defaultFilename);
    if (fs.existsSync(defaultPath)) {
      return fs.readFileSync(defaultPath, 'utf8');
    }

    throw new Error(`Template file not found for: ${templateId}`);
  }

  loadTemplate(templateId) {
    const entry = PROMPT_REGISTRY.find(e => e.id === templateId);
    if (!entry) {
      throw new Error(`Unknown template ID: ${templateId}`);
    }

    const overridePath = this.getOverridePath(entry.defaultFilename);
    const defaultPath = this.getDefaultPath(entry.defaultFilename);

    let filePath;
    if (fs.existsSync(overridePath)) {
      filePath = overridePath;
    } else if (fs.existsSync(defaultPath)) {
      filePath = defaultPath;
    } else {
      throw new Error(`Template file not found: ${templateId}`);
    }

    const cacheKey = templateId;
    const currentMtime = fs.statSync(filePath).mtimeMs;
    const cachedMtime = this.cacheMtime.get(filePath) || 0;

    if (this.cache.has(cacheKey) && currentMtime === cachedMtime) {
      return this.cache.get(cacheKey);
    }

    const content = fs.readFileSync(filePath, 'utf8');
    this.cache.set(cacheKey, content);
    this.cacheMtime.set(filePath, currentMtime);

    return content;
  }

  render(templateId, context) {
    const template = this.loadTemplate(templateId);
    return this.engine.parseAndRenderSync(template, { context });
  }

  renderAsync(templateId, context) {
    const template = this.loadTemplate(templateId);
    return this.engine.parseAndRender(template, { context });
  }

  getRegistry() {
    return PROMPT_REGISTRY.map(entry => {
      const overridePath = this.getOverridePath(entry.defaultFilename);
      const isOverridden = fs.existsSync(overridePath);
      let lastModified = null;

      if (isOverridden) {
        try {
          lastModified = fs.statSync(overridePath).mtimeMs;
        } catch (e) { /* ignore */ }
      }

      return {
        id: entry.id,
        title: entry.title,
        description: entry.description,
        category: entry.category,
        responseMode: entry.responseMode,
        supportsPreview: entry.supportsPreview,
        variables: entry.variables,
        isOverridden,
        lastModified
      };
    });
  }

  listTemplates() {
    return this.getRegistry();
  }

  saveOverride(templateId, content) {
    const entry = PROMPT_REGISTRY.find(e => e.id === templateId);
    if (!entry) {
      throw new Error(`Unknown template ID: ${templateId}`);
    }

    this.ensureOverrideDir();
    const overridePath = this.getOverridePath(entry.defaultFilename);
    fs.writeFileSync(overridePath, content, 'utf8');

    this.cache.delete(templateId);
    this.cacheMtime.set(overridePath, fs.statSync(overridePath).mtimeMs);

    return true;
  }

  resetToDefault(templateId) {
    const entry = PROMPT_REGISTRY.find(e => e.id === templateId);
    if (!entry) {
      throw new Error(`Unknown template ID: ${templateId}`);
    }

    const overridePath = this.getOverridePath(entry.defaultFilename);
    if (fs.existsSync(overridePath)) {
      fs.unlinkSync(overridePath);
    }

    this.cache.delete(templateId);
    this.cacheMtime.delete(overridePath);

    return true;
  }

  buildRewriteContext(question, conversationHistory = [], uiFilters = {}, explicitFilters = {}, languageHint = 'en') {
    const now = new Date();
    const safeHistory = conversationHistory || [];
    const safeUiFilters = uiFilters || {};
    const safeExplicitFilters = explicitFilters || {};
    const historyTranscripts = safeHistory
      .slice(-10)
      .map(msg => `${msg.role}: ${msg.content}`);

    const effectiveFilters = {
      ...safeExplicitFilters,
      ...safeUiFilters
    };

    return {
      currentDate: format(now, 'yyyy-MM-dd'),
      currentDateTime: format(now, "yyyy-MM-dd'T'HH:mm:ss"),
      languageHint,
      question,
      conversationHistory: safeHistory.slice(-10),
      conversationTranscriptText: historyTranscripts.join('\n'),
      uiFilters: safeUiFilters,
      effectiveFilters,
      effectiveFiltersJson: JSON.stringify(effectiveFilters),
      supportedFilters: ['from_date', 'to_date', 'correspondent', 'document_type', 'tags', 'language']
    };
  }

  buildAnswerContext(question, conversationHistory = [], effectiveFilters = {}, sources = [], documents = [], languageHint = 'en') {
    const now = new Date();
    const safeHistory = conversationHistory || [];
    const safeDocuments = documents || [];
    const safeSources = sources || [];
    const historyTranscripts = safeHistory
      .slice(-10)
      .map(msg => `${msg.role}: ${msg.content}`);

    const documentsXml = safeDocuments.map((doc, i) => {
      let xml = `  <document>\n    <title>${this.escapeXml(doc.title || '')}</title>\n    <content>${this.escapeXml(this.truncate(doc.content || '', 2000))}</content>\n    <correspondent>${this.escapeXml(doc.correspondent || '')}</correspondent>\n    <document_type>${this.escapeXml(doc.documentTypeName || '')}</document_type>\n    <created_date>${this.escapeXml(doc.createdDate || '')}</created_date>`;

      if (doc.customFields && doc.customFields.length > 0) {
        for (const field of doc.customFields) {
          xml += `\n    <custom_field>\n      <name>${this.escapeXml(field.name || '')}</name>\n      <value>${this.escapeXml(field.value || '')}</value>\n    </custom_field>`;
        }
      }

      xml += '\n  </document>';
      return xml;
    }).join('\n');

    return {
      currentDate: format(now, 'yyyy-MM-dd'),
      currentDateTime: format(now, "yyyy-MM-dd'T'HH:mm:ss"),
      languageHint,
      question,
      conversationHistory: safeHistory.slice(-10),
      conversationTranscriptText: historyTranscripts.join('\n'),
      effectiveFilters,
      effectiveFiltersJson: JSON.stringify(effectiveFilters || {}),
      sources: safeSources.map((s, i) => ({
        index: i + 1,
        title: s.title || '',
        correspondent: s.correspondent || '',
        date: s.date || '',
        tags: s.tags || ''
      })),
      documents: safeDocuments,
      documentsXml
    };
  }

  buildAnswerPlannerContext(question, conversationHistory = [], effectiveFilters = {}, sources = [], languageHint = 'en') {
    const now = new Date();
    const safeHistory = conversationHistory || [];
    const safeSources = sources || [];
    const historyTranscripts = safeHistory
      .slice(-10)
      .map(msg => `${msg.role}: ${msg.content}`);

    return {
      currentDate: format(now, 'yyyy-MM-dd'),
      currentDateTime: format(now, "yyyy-MM-dd'T'HH:mm:ss"),
      languageHint,
      question,
      conversationHistory: safeHistory.slice(-10),
      conversationTranscriptText: historyTranscripts.join('\n'),
      effectiveFilters,
      effectiveFiltersJson: JSON.stringify(effectiveFilters || {}),
      sources: safeSources.map((s, i) => ({
        index: i + 1,
        title: s.title || '',
        correspondent: s.correspondent || '',
        date: s.date || '',
        tags: s.tags || '',
        snippet: this.truncate(s.snippet || '', 500),
        docId: s.doc_id || s.document_id || ''
      }))
    };
  }

  buildDocumentAnalysisContext(documentContent, existingTags = [], existingCorrespondents = [], existingDocumentTypes = [], customFieldDefinitions = [], languageHint = 'en') {
    const now = new Date();

    return {
      currentDate: format(now, 'yyyy-MM-dd'),
      currentDateTime: format(now, "yyyy-MM-dd'T'HH:mm:ss"),
      languageHint,
      documentContent: this.truncate(documentContent || '', 10000),
      existingTags,
      existingCorrespondents,
      existingDocumentTypes,
      customFieldDefinitions,
      customFieldsSchema: JSON.stringify(
        customFieldDefinitions.reduce((acc, field) => {
          acc[field.name] = field.hint || '';
          return acc;
        }, {})
      )
    };
  }

  buildPredefinedTagsContext(allowedTags = [], existingTags = [], existingCorrespondents = [], existingDocumentTypes = [], customFieldDefinitions = [], languageHint = 'en') {
    const now = new Date();

    return {
      currentDate: format(now, 'yyyy-MM-dd'),
      currentDateTime: format(now, "yyyy-MM-dd'T'HH:mm:ss"),
      languageHint,
      allowedTags,
      existingTags,
      existingCorrespondents,
      existingDocumentTypes,
      customFieldDefinitions,
      customFieldsSchema: JSON.stringify(
        customFieldDefinitions.reduce((acc, field) => {
          acc[field.name] = field.hint || '';
          return acc;
        }, {})
      )
    };
  }

  buildChatSystemContext(documentTitle, documentContent, documentCreated, documentCorrespondent, question = '', languageHint = 'en') {
    const now = new Date();

    return {
      currentDate: format(now, 'yyyy-MM-dd'),
      currentDateTime: format(now, "yyyy-MM-dd'T'HH:mm:ss"),
      languageHint,
      documentTitle: documentTitle || '',
      documentContent: this.truncate(documentContent || '', 5000),
      documentCreated: documentCreated || '',
      documentCorrespondent: documentCorrespondent || '',
      question
    };
  }

  buildPlaygroundContext(documentContent, customPrompt = '', languageHint = 'en') {
    const now = new Date();

    return {
      currentDate: format(now, 'yyyy-MM-dd'),
      currentDateTime: format(now, "yyyy-MM-dd'T'HH:mm:ss"),
      languageHint,
      documentContent: this.truncate(documentContent || '', 10000),
      customPrompt: customPrompt || ''
    };
  }

  buildTextGenerationContext(languageHint = 'en') {
    const now = new Date();

    return {
      currentDate: format(now, 'yyyy-MM-dd'),
      currentDateTime: format(now, "yyyy-MM-dd'T'HH:mm:ss"),
      languageHint
    };
  }

  truncate(str, maxLen) {
    if (!str || str.length <= maxLen) return str;
    return str.substring(0, maxLen) + '...';
  }

  escapeXml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  validateTemplate(templateId, content) {
    const entry = PROMPT_REGISTRY.find(e => e.id === templateId);
    if (!entry) {
      return { valid: false, error: `Unknown template ID: ${templateId}` };
    }

    try {
      this.engine.parse(content);
      return { valid: true };
    } catch (err) {
      return { valid: false, error: err.message };
    }
  }

  getSampleContext(templateId) {
    const entry = PROMPT_REGISTRY.find(e => e.id === templateId);
    if (!entry) return null;

    const now = new Date();
    const baseContext = {
      currentDate: format(now, 'yyyy-MM-dd'),
      currentDateTime: format(now, "yyyy-MM-dd'T'HH:mm:ss"),
      languageHint: 'en'
    };

    switch (templateId) {
      case 'rag.query_rewrite':
        return {
          ...baseContext,
          question: 'What invoices did I receive last month?',
          conversationHistory: [
            { role: 'user', content: 'Show me my recent bank statements' },
            { role: 'assistant', content: 'I found 3 bank statements from April 2026.' }
          ],
          uiFilters: { correspondent: 'MyBank' },
          effectiveFilters: { from_date: '2026-03-01', to_date: '2026-04-15', correspondent: 'MyBank' }
        };

      case 'rag.answer_lightweight':
      case 'rag.answer_plan':
      case 'rag.answer_final':
        return {
          ...baseContext,
          question: 'What is the total amount on invoice #1234?',
          conversationHistory: [
            { role: 'user', content: 'Show me my recent invoices' }
          ],
          effectiveFilters: { from_date: '2026-01-01', to_date: '2026-04-15' },
          sources: [
            { index: 1, title: 'Invoice_1234.pdf', correspondent: 'Acme Corp', date: '2026-04-10' },
            { index: 2, title: 'Invoice_1235.pdf', correspondent: 'Acme Corp', date: '2026-04-12' }
          ],
          documents: [
            {
              title: 'Invoice_1234.pdf',
              content: 'INVOICE #1234\nAcme Corp\nDate: 2026-04-10\nTotal Amount: $1,250.00\nDue: 2026-04-25',
              correspondent: 'Acme Corp',
              documentTypeName: 'Invoice',
              createdDate: '2026-04-10',
              customFields: [{ name: 'Invoice Amount', value: '$1,250.00' }]
            },
            {
              title: 'Invoice_1235.pdf',
              content: 'INVOICE #1235\nAcme Corp\nDate: 2026-04-12\nTotal Amount: $899.00',
              correspondent: 'Acme Corp',
              documentTypeName: 'Invoice',
              createdDate: '2026-04-12',
              customFields: []
            }
          ]
        };

      case 'document.analysis.body':
        return baseContext;

      case 'document.analysis.schema':
        return {
          ...baseContext,
          customFieldsSchema: JSON.stringify({ 'Invoice Amount': 'Fill in the amount', 'Due Date': 'YYYY-MM-DD' })
        };

      case 'document.analysis.predefined_tags':
        return {
          ...baseContext,
          allowedTags: ['Invoice', 'Contract', 'Bank Statement', 'Receipt', 'Letter']
        };

      case 'chat.document.system':
        return {
          ...baseContext,
          documentTitle: 'Contract_2026.pdf',
          documentCreated: '2026-04-01',
          documentCorrespondent: 'Acme Corp',
          question: 'What is the contract value?'
        };

      case 'playground.analysis.schema':
        return baseContext;

      case 'text.generation.system':
        return baseContext;

      default:
        return baseContext;
    }
  }
}

module.exports = new PromptTemplateService();
