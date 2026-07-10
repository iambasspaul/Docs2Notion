import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  FileText,
  ArrowRight,
  Database,
  RefreshCw,
  CheckCircle,
  XCircle,
  Settings,
  HelpCircle,
  Eye,
  EyeOff,
  Sparkles,
  Link2,
  BookOpen,
  Info,
  Layers,
  LogOut,
  ChevronRight,
  ExternalLink,
  Plus,
  Trash2,
  Shield,
  Mail,
  Key
} from 'lucide-react';
import { googleSignIn, logout, initAuth } from '../lib/firebase';
import { User } from 'firebase/auth';
import { PipelineOptions, PipelineStep, EtlResponse, NotionConfigStatus } from '../types';

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

export default function DocToNotionEtl() {
  // Auth state
  const [user, setUser] = useState<User | null>(null);
  const [googleToken, setGoogleToken] = useState<string | null>(null);
  const [needsAuth, setNeedsAuth] = useState(true);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // Administrative verification state
  const [isAdmin, setIsAdmin] = useState(false);
  const [isAllowed, setIsAllowed] = useState(true);
  const [adminConfig, setAdminConfig] = useState<AdminConfig>({
    adminEmail: '',
    allowedEmails: [],
    replaceKeywords: [],
    notionApiKey: '',
    notionParentPageId: '',
    geminiApiKey: ''
  });

  // Navigation states
  const [activeTab, setActiveTab] = useState<'pipeline' | 'admin'>('pipeline');
  const [adminActiveSubTab, setAdminActiveSubTab] = useState<'connections' | 'access' | 'keywords'>('connections');

  // Admin Config local inputs
  const [adminNotionKey, setAdminNotionKey] = useState('');
  const [adminNotionParent, setAdminNotionParent] = useState('');
  const [adminGeminiKey, setAdminGeminiKey] = useState('');
  const [showAdminNotionKey, setShowAdminNotionKey] = useState(false);
  const [showAdminGeminiKey, setShowAdminGeminiKey] = useState(false);

  // Lists management inputs
  const [newAllowedEmail, setNewAllowedEmail] = useState('');
  const [newKeywordFind, setNewKeywordFind] = useState('');
  const [newKeywordReplace, setNewKeywordReplace] = useState('');

  // Admin status alerts
  const [adminSuccessMsg, setAdminSuccessMsg] = useState<string | null>(null);
  const [adminErrMsg, setAdminErrMsg] = useState<string | null>(null);

  // Notion credentials environment status
  const [notionStatus, setNotionStatus] = useState<NotionConfigStatus>({
    isConfigured: false,
    hasApiKey: false,
    hasParentPageId: false
  });

  // Inputs & options for pipeline
  const [googleDocUrl, setGoogleDocUrl] = useState('');
  const [pipelineOptions, setPipelineOptions] = useState<PipelineOptions>({
    cleanText: true,
    aiSummarize: true,
    aiKeywords: true,
    translateLanguage: ''
  });

  // UI / Pipeline States
  const [isProcessing, setIsProcessing] = useState(false);
  const [pipelineLogs, setPipelineLogs] = useState<string[]>([]);
  const [pipelineSteps, setPipelineSteps] = useState<PipelineStep[]>([
    {
      id: 'extract',
      name: 'Extract (E)',
      description: 'Fetch and parse the raw Google Doc content and structure.',
      status: 'idle',
      message: 'Awaiting start...'
    },
    {
      id: 'transform',
      name: 'Transform (T)',
      description: 'Clean typography, perform keyword replacements, and run AI insights.',
      status: 'idle',
      message: 'Awaiting start...'
    },
    {
      id: 'load',
      name: 'Load (L)',
      description: 'Convert elements into Notion blocks and publish the final page.',
      status: 'idle',
      message: 'Awaiting start...'
    }
  ]);

  // Results
  const [result, setResult] = useState<EtlResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Fetch server Notion status (checks env vars + admin overrides)
  const fetchNotionStatus = async () => {
    try {
      const res = await fetch('/api/notion/status');
      if (res.ok) {
        const data = await res.json();
        setNotionStatus(data);
      }
    } catch (err) {
      console.error('Failed to fetch Notion status:', err);
    }
  };

  // Fetch Admin Configuration
  const fetchAdminConfig = async (email?: string) => {
    const userEmail = email || user?.email;
    if (!userEmail) return;
    try {
      const res = await fetch('/api/admin/config', {
        headers: {
          'x-user-email': userEmail
        }
      });
      if (res.ok) {
        const data = await res.json();
        setAdminConfig(data.config);
        setAdminNotionKey(data.config.notionApiKey || '');
        setAdminNotionParent(data.config.notionParentPageId || '');
        setAdminGeminiKey(data.config.geminiApiKey || '');
      }
    } catch (err) {
      console.error('Failed to fetch admin config:', err);
    }
  };

  // Check user status (first login user becomes admin automatically)
  const checkUserStatus = async (email: string) => {
    try {
      const res = await fetch('/api/auth/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      if (res.ok) {
        const data = await res.json();
        setIsAdmin(data.isAdmin);
        setIsAllowed(data.isAllowed);
        if (data.isAdmin) {
          await fetchAdminConfig(email);
        }
        if (!data.isAllowed) {
          setErrorMessage(`Access denied. Your email (${email}) is not authorized to use this application.`);
        }
      }
    } catch (err) {
      console.error('Failed to verify user status:', err);
    }
  };

  useEffect(() => {
    // Initialize Firebase Auth listener
    const unsubscribe = initAuth(
      (currentUser, token) => {
        setUser(currentUser);
        setGoogleToken(token);
        setNeedsAuth(false);
        if (currentUser.email) {
          checkUserStatus(currentUser.email);
        }
      },
      () => {
        setUser(null);
        setGoogleToken(null);
        setNeedsAuth(true);
        setIsAdmin(false);
        setIsAllowed(true);
      }
    );

    fetchNotionStatus();

    return () => unsubscribe();
  }, []);

  const handleGoogleLogin = async () => {
    setIsLoggingIn(true);
    setErrorMessage(null);
    try {
      const res = await googleSignIn();
      if (res) {
        setUser(res.user);
        setGoogleToken(res.accessToken);
        setNeedsAuth(false);
        if (res.user.email) {
          await checkUserStatus(res.user.email);
        }
      }
    } catch (err: any) {
      console.error('Google login failed:', err);
      setErrorMessage(`Authentication failed: ${err.message || 'Check your browser pop-up blocker.'}`);
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleGoogleLogout = async () => {
    await logout();
    setUser(null);
    setGoogleToken(null);
    setNeedsAuth(true);
    setResult(null);
    setIsAdmin(false);
    setIsAllowed(true);
    setActiveTab('pipeline');
  };

  const updateStep = (id: string, updates: Partial<PipelineStep>) => {
    setPipelineSteps((prev) =>
      prev.map((step) => (step.id === id ? { ...step, ...updates } : step))
    );
  };

  const addLog = (message: string) => {
    setPipelineLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${message}`]);
  };

  // Run ETL Pipeline
  const runEtlPipeline = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!googleDocUrl.trim()) return;
    if (!googleToken) {
      setErrorMessage('Google token expired. Please re-authenticate.');
      return;
    }

    setIsProcessing(true);
    setResult(null);
    setErrorMessage(null);
    setPipelineLogs([]);

    // Reset steps to running/idle states
    setPipelineSteps([
      {
        id: 'extract',
        name: 'Extract (E)',
        description: 'Fetch and parse the raw Google Doc content and structure.',
        status: 'running',
        message: 'Initializing Google API fetch...'
      },
      {
        id: 'transform',
        name: 'Transform (T)',
        description: 'Clean typography, perform keyword replacements, and run AI insights.',
        status: 'idle',
        message: 'Awaiting extraction...'
      },
      {
        id: 'load',
        name: 'Load (L)',
        description: 'Convert elements into Notion blocks and publish the final page.',
        status: 'idle',
        message: 'Awaiting transformation...'
      }
    ]);

    addLog('Starting Google Docs to Notion ETL Pipeline.');
    addLog('Extract Stage: Querying Google Docs API for document data...');

    try {
      // Extract Stage simulation logs
      setTimeout(() => {
        addLog('Extract Stage: Successfully authenticated with Google Workspace credentials.');
        addLog('Extract Stage: Document metadata located. Downloading content hierarchy...');
      }, 800);

      // Transform simulation logs
      let transformTimer = setTimeout(() => {
        updateStep('extract', { status: 'completed', message: 'Extracted structural layout successfully.' });
        updateStep('transform', { status: 'running', message: 'Cleaning typography and running AI transforms...' });
        addLog('Transform Stage: Ingestion clean active. Collapsing excess whitespaces.');
        
        if (adminConfig.replaceKeywords && adminConfig.replaceKeywords.length > 0) {
          addLog(`Transform Stage: Running ${adminConfig.replaceKeywords.length} custom keyword replacement rules.`);
        }
        if (pipelineOptions.translateLanguage) {
          addLog(`Transform Stage: Translating document content to "${pipelineOptions.translateLanguage}" using Gemini AI.`);
        }
        if (pipelineOptions.aiSummarize) {
          addLog('Transform Stage: Formulating automatic TL;DR summary bullets via Gemini AI.');
        }
        if (pipelineOptions.aiKeywords) {
          addLog('Transform Stage: Generating document keywords and indexing tags.');
        }
      }, 2000);

      // Load simulation logs
      let loadTimer = setTimeout(() => {
        updateStep('transform', { status: 'completed', message: 'AI Transformation and keyword replacement complete.' });
        updateStep('load', { status: 'running', message: 'Constructing Notion blocks & establishing page...' });
        addLog('Load Stage: Converting parsed elements to standardized Notion API rich blocks.');
        addLog('Load Stage: Opening child page under parent container in Notion...');
      }, 4500);

      // Call pipeline run API
      const response = await fetch('/api/pipeline/run', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-email': user?.email || ''
        },
        body: JSON.stringify({
          googleDocUrl,
          googleToken,
          pipelineOptions
        })
      });

      // Clear timers immediately
      clearTimeout(transformTimer);
      clearTimeout(loadTimer);

      let data: EtlResponse;
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        data = await response.json();
      } else {
        const text = await response.text();
        if (response.status === 502 || response.status === 503) {
          throw new Error(`The proxy server returned a Gateway Error (${response.status}). This often happens when downstream services fail. Please check that the Google Docs API is enabled in your Google Cloud Project.`);
        }
        throw new Error(`Server returned a non-JSON response (status ${response.status}). Details: ${text.slice(0, 300)}`);
      }

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Pipeline run failed.');
      }

      // Mark steps complete
      setPipelineSteps((prev) =>
        prev.map((step) => ({
          ...step,
          status: 'completed',
          message: 'Completed successfully.'
        }))
      );

      addLog(`Load Stage: Page published successfully in Notion: "${data.title}"`);
      addLog('ETL Pipeline successfully completed.');
      setResult(data);
    } catch (err: any) {
      console.error('ETL Pipeline Error:', err);
      setPipelineSteps((prev) => {
        const next = [...prev];
        const runningIndex = next.findIndex((s) => s.status === 'running' || s.status === 'idle');
        if (runningIndex !== -1) {
          next[runningIndex].status = 'failed';
          next[runningIndex].message = err.message || 'Pipeline step failed.';
        }
        return next;
      });
      addLog(`[CRITICAL ERROR] Pipeline aborted: ${err.message}`);
      setErrorMessage(err.message || 'An unexpected error occurred during the ETL process.');
    } finally {
      setIsProcessing(false);
    }
  };

  // Admin settings save helper
  const handleSaveConnections = async (e: React.FormEvent) => {
    e.preventDefault();
    await saveAdminSettings({
      notionApiKey: adminNotionKey,
      notionParentPageId: adminNotionParent,
      geminiApiKey: adminGeminiKey
    });
  };

  // Admin allowed login email management
  const handleAddAllowedEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAllowedEmail.trim()) return;
    const lowerEmail = newAllowedEmail.toLowerCase().trim();
    if (adminConfig.allowedEmails.includes(lowerEmail)) {
      setAdminErrMsg('Email is already on the allowed login list.');
      return;
    }
    const updated = [...adminConfig.allowedEmails, lowerEmail];
    await saveAdminSettings({ allowedEmails: updated });
    setNewAllowedEmail('');
  };

  const handleRemoveAllowedEmail = async (emailToRemove: string) => {
    const updated = adminConfig.allowedEmails.filter((email) => email !== emailToRemove);
    await saveAdminSettings({ allowedEmails: updated });
  };

  // Admin keyword replacements rules management
  const handleAddKeywordRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKeywordFind.trim()) return;
    const rule = {
      find: newKeywordFind,
      replace: newKeywordReplace
    };
    if (adminConfig.replaceKeywords.some((r) => r.find === rule.find)) {
      setAdminErrMsg(`A rule already exists for finding keyword "${rule.find}".`);
      return;
    }
    const updated = [...adminConfig.replaceKeywords, rule];
    await saveAdminSettings({ replaceKeywords: updated });
    setNewKeywordFind('');
    setNewKeywordReplace('');
  };

  const handleRemoveKeywordRule = async (findText: string) => {
    const updated = adminConfig.replaceKeywords.filter((r) => r.find !== findText);
    await saveAdminSettings({ replaceKeywords: updated });
  };

  const saveAdminSettings = async (updates: Partial<AdminConfig>) => {
    if (!user?.email) return;
    setAdminSuccessMsg(null);
    setAdminErrMsg(null);

    const mergedConfig = {
      allowedEmails: updates.allowedEmails !== undefined ? updates.allowedEmails : adminConfig.allowedEmails,
      replaceKeywords: updates.replaceKeywords !== undefined ? updates.replaceKeywords : adminConfig.replaceKeywords,
      notionApiKey: updates.notionApiKey !== undefined ? updates.notionApiKey : adminNotionKey,
      notionParentPageId: updates.notionParentPageId !== undefined ? updates.notionParentPageId : adminNotionParent,
      geminiApiKey: updates.geminiApiKey !== undefined ? updates.geminiApiKey : adminGeminiKey
    };

    try {
      const res = await fetch('/api/admin/config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-email': user.email
        },
        body: JSON.stringify(mergedConfig)
      });
      if (res.ok) {
        const data = await res.json();
        setAdminConfig(data.config);
        setAdminSuccessMsg('Administrative settings saved successfully!');
        setTimeout(() => setAdminSuccessMsg(null), 3000);
        fetchNotionStatus();
      } else {
        const errData = await res.json();
        setAdminErrMsg(errData.error || 'Failed to save administrative configuration.');
      }
    } catch (err) {
      console.error('Failed to save administrative config:', err);
      setAdminErrMsg('A network error occurred while saving.');
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans leading-relaxed">
      {/* Top Banner / Navbar */}
      <nav className="border-b border-slate-200 bg-white sticky top-0 z-50 shadow-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-6">
            <div className="flex items-center space-x-3">
              <div className="bg-blue-600 text-white p-2 rounded-xl">
                <Layers className="h-6 w-6" id="logo-icon" />
              </div>
              <div>
                <span className="font-display font-bold text-lg tracking-tight text-slate-900">
                  DocsToNotion <span className="text-blue-600 font-semibold text-sm">ETL</span>
                </span>
                <p className="text-xs text-slate-500 font-mono">Pipeline version 1.2.0</p>
              </div>
            </div>

            {/* Admin Toggle Tabs - ONLY visible to verified Admin */}
            {user && isAdmin && isAllowed && (
              <div className="hidden sm:flex space-x-1 bg-slate-100 p-1 rounded-xl">
                <button
                  onClick={() => setActiveTab('pipeline')}
                  className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                    activeTab === 'pipeline'
                      ? 'bg-white text-blue-600 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Pipeline Dashboard
                </button>
                <button
                  onClick={() => setActiveTab('admin')}
                  className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer flex items-center space-x-1.5 ${
                    activeTab === 'admin'
                      ? 'bg-white text-blue-600 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Shield className="h-3.5 w-3.5 text-blue-600" />
                  <span>Manager Panel</span>
                </button>
              </div>
            )}
          </div>

          <div className="flex items-center space-x-4">
            {user ? (
              <div className="flex items-center space-x-3">
                <div className="hidden md:block text-right">
                  <div className="flex items-center justify-end space-x-1.5">
                    <p className="text-sm font-medium text-slate-900">{user.displayName || 'Google User'}</p>
                    {isAdmin && (
                      <span className="px-1.5 py-0.5 bg-blue-100 text-blue-800 text-[9px] font-extrabold uppercase rounded-md tracking-wider">
                        Admin
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 font-mono">{user.email}</p>
                </div>
                <img
                  src={user.photoURL || 'https://lh3.googleusercontent.com/a/default-user=s96-c'}
                  alt="Avatar"
                  className="w-8 h-8 rounded-full border border-slate-200"
                  referrerPolicy="no-referrer"
                />
                <button
                  onClick={handleGoogleLogout}
                  className="text-slate-400 hover:text-red-600 p-1.5 rounded-lg hover:bg-red-50 transition"
                  title="Sign Out"
                  id="sign-out-btn"
                >
                  <LogOut className="h-5 w-5" />
                </button>
              </div>
            ) : (
              <span className="text-xs font-mono text-slate-400 px-2 py-1 bg-slate-100 rounded-md">
                🔒 Protected Pipeline
              </span>
            )}
          </div>
        </div>
      </nav>

      {/* Main Container */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        
        {/* Blocked message for unauthorized log-ins */}
        {user && !isAllowed ? (
          <div className="max-w-xl mx-auto bg-white rounded-2xl border border-slate-200 shadow-xl overflow-hidden p-8 text-center mt-12">
            <div className="w-16 h-16 bg-red-50 text-red-600 rounded-full flex items-center justify-center mx-auto mb-6">
              <XCircle className="h-8 w-8" />
            </div>
            <h2 className="font-display font-bold text-xl text-slate-900 mb-2">Access Denied</h2>
            <p className="text-slate-600 text-sm mb-4 max-w-md mx-auto">
              Your Google Account email (<b>{user.email}</b>) is not authorized to access this pipeline.
            </p>
            <p className="text-slate-500 text-xs mb-8">
              Please contact the website administrator to register your email in the authorized logins list.
            </p>
            <button
              onClick={handleGoogleLogout}
              className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium py-2.5 px-5 rounded-xl transition text-sm cursor-pointer border border-slate-300 shadow-xs"
            >
              Sign Out & Try Another Account
            </button>
          </div>
        ) : needsAuth ? (
          /* Login Guard Card */
          <div className="max-w-xl mx-auto bg-white rounded-2xl border border-slate-200 shadow-xl overflow-hidden p-8 text-center mt-12">
            <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-6">
              <FileText className="h-8 w-8" />
            </div>
            <h2 className="font-display font-bold text-xl text-slate-900 mb-2">Google Authentication Required</h2>
            <p className="text-slate-600 text-sm mb-8 max-w-md mx-auto">
              To browse and extract content from your Google Documents, securely connect your Google account below. We only ask for readonly permissions to Google Docs and Google Drive.
            </p>

            <button
              onClick={handleGoogleLogin}
              disabled={isLoggingIn}
              className="w-full sm:w-auto inline-flex items-center justify-center bg-white hover:bg-slate-50 text-slate-700 font-medium py-3 px-6 border border-slate-300 rounded-xl shadow-sm transition active:scale-98 disabled:opacity-50 space-x-3 cursor-pointer"
              id="google-login-btn"
            >
              {isLoggingIn ? (
                <RefreshCw className="h-5 w-5 animate-spin text-slate-500" />
              ) : (
                <svg className="h-5 w-5" version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
                  <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"></path>
                  <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"></path>
                  <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"></path>
                  <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"></path>
                </svg>
              )}
              <span>{isLoggingIn ? 'Connecting...' : 'Sign in with Google'}</span>
            </button>
          </div>
        ) : (
          /* Main authorized container area */
          <div>
            {/* ------------------------- TAB 1: PIPELINE DASHBOARD ------------------------- */}
            {activeTab === 'pipeline' && (
              <div className="space-y-8 animate-fade-in">
                {/* Header Hero */}
                <div className="mb-10 text-center max-w-3xl mx-auto">
                  <span className="px-3 py-1 text-xs font-semibold text-blue-700 bg-blue-50 rounded-full border border-blue-100 uppercase tracking-wider inline-block mb-3">
                    Gemini-Powered ETL Pipeline
                  </span>
                  <h1 className="font-display font-extrabold text-3xl sm:text-4xl text-slate-900 tracking-tight mb-4">
                    Convert Google Docs to Structured Notion Pages
                  </h1>
                  <p className="text-slate-600 text-base">
                    Read files directly from your Google Drive, run robust cleaning, formatting, translations, and custom keyword overrides, and compile beautifully formatted Notion page blocks instantly.
                  </p>
                </div>

                {/* Global Error Banner */}
                {errorMessage && (
                  <motion.div
                    initial={{ opacity: 0, y: -15 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 flex items-start space-x-3"
                    id="error-banner"
                  >
                    <XCircle className="h-5 w-5 shrink-0 mt-0.5" />
                    <div className="text-sm whitespace-pre-line">
                      <span className="font-semibold">Pipeline Error:</span> {errorMessage}
                    </div>
                  </motion.div>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                  {/* Left Column - Form Config */}
                  <div className="lg:col-span-2 space-y-8">
                    <form onSubmit={runEtlPipeline} className="bg-white rounded-2xl border border-slate-200 shadow-xs p-6 sm:p-8 space-y-6">
                      
                      {/* Section 1: Ingestion Source */}
                      <div>
                        <h3 className="font-display font-bold text-lg text-slate-900 flex items-center space-x-2 mb-4">
                          <span className="w-6 h-6 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-mono font-bold">1</span>
                          <span>Document Ingestion Source</span>
                        </h3>
                        <div className="space-y-3">
                          <label className="block text-sm font-medium text-slate-700" htmlFor="google-doc-input">
                            Google Document Link or ID <span className="text-red-500">*</span>
                          </label>
                          <div className="relative rounded-xl shadow-xs">
                            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                              <FileText className="h-5 w-5" />
                            </div>
                            <input
                              type="text"
                              id="google-doc-input"
                              required
                              placeholder="https://docs.google.com/document/d/.../edit"
                              value={googleDocUrl}
                              onChange={(e) => setGoogleDocUrl(e.target.value)}
                              className="block w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-hidden transition text-slate-800 text-sm"
                            />
                          </div>
                          <p className="text-xs text-slate-500">
                            Supports raw document IDs or copying the full address from your browser. Ensure the document is shared with or owned by the logged-in Google account.
                          </p>
                        </div>
                      </div>

                      <hr className="border-slate-200" />

                      {/* Section 2: Ingestion Clean & Transform Pipeline */}
                      <div>
                        <h3 className="font-display font-bold text-lg text-slate-900 flex items-center space-x-2 mb-4">
                          <span className="w-6 h-6 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-mono font-bold">2</span>
                          <span>ETL Transformation Pipeline (Gemini AI)</span>
                        </h3>

                        <div className="space-y-4">
                          {/* Checkbox Options */}
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            
                            {/* Clean Text Toggle */}
                            <label className="flex items-start p-3 bg-slate-50 rounded-xl border border-slate-200 cursor-pointer hover:bg-slate-100/70 transition">
                              <input
                                type="checkbox"
                                checked={pipelineOptions.cleanText}
                                onChange={(e) => setPipelineOptions({ ...pipelineOptions, cleanText: e.target.checked })}
                                className="mt-1 h-4 w-4 text-blue-600 focus:ring-blue-500 border-slate-300 rounded-sm"
                              />
                              <div className="ml-3 text-xs">
                                <span className="font-medium text-slate-900 block">Clean Text</span>
                                <span className="text-slate-500">Standardize spacing, collapse multiple blank lines & quotes.</span>
                              </div>
                            </label>

                            {/* AI Summarize Toggle */}
                            <label className="flex items-start p-3 bg-slate-50 rounded-xl border border-slate-200 cursor-pointer hover:bg-slate-100/70 transition">
                              <input
                                type="checkbox"
                                checked={pipelineOptions.aiSummarize}
                                onChange={(e) => setPipelineOptions({ ...pipelineOptions, aiSummarize: e.target.checked })}
                                className="mt-1 h-4 w-4 text-blue-600 focus:ring-blue-500 border-slate-300 rounded-sm"
                              />
                              <div className="ml-3 text-xs">
                                <span className="font-medium text-slate-900 flex items-center space-x-1">
                                  <span>AI TL;DR Summary</span>
                                  <Sparkles className="h-3 w-3 text-amber-500" />
                                </span>
                                <span className="text-slate-500">Inject an AI key takeaways callout block at the top in Notion.</span>
                              </div>
                            </label>

                            {/* AI Keywords Toggle */}
                            <label className="flex items-start p-3 bg-slate-50 rounded-xl border border-slate-200 cursor-pointer hover:bg-slate-100/70 transition">
                              <input
                                type="checkbox"
                                checked={pipelineOptions.aiKeywords}
                                onChange={(e) => setPipelineOptions({ ...pipelineOptions, aiKeywords: e.target.checked })}
                                className="mt-1 h-4 w-4 text-blue-600 focus:ring-blue-500 border-slate-300 rounded-sm"
                              />
                              <div className="ml-3 text-xs">
                                <span className="font-medium text-slate-900 flex items-center space-x-1">
                                  <span>AI Tags Extract</span>
                                  <Sparkles className="h-3 w-3 text-amber-500" />
                                </span>
                                <span className="text-slate-500">Scan topics to generate relevant classification tag blocks.</span>
                              </div>
                            </label>
                          </div>

                          {/* Advanced Dropdown Options */}
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                            {/* Translation Target */}
                            <div className="space-y-1.5 col-span-2">
                              <label className="text-xs font-semibold text-slate-700" htmlFor="translate-select">
                                Translate Content To
                              </label>
                              <select
                                id="translate-select"
                                value={pipelineOptions.translateLanguage}
                                onChange={(e) => setPipelineOptions({ ...pipelineOptions, translateLanguage: e.target.value })}
                                className="block w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs text-slate-800 focus:bg-white focus:ring-2 focus:ring-blue-500 outline-hidden transition"
                              >
                                <option value="">Keep Original Language (No translation)</option>
                                <option value="Spanish">Spanish (Español)</option>
                                <option value="French">French (Français)</option>
                                <option value="German">German (Deutsch)</option>
                                <option value="Japanese">Japanese (日本語)</option>
                                <option value="Portuguese">Portuguese (Português)</option>
                                <option value="Chinese">Chinese (中文)</option>
                                <option value="Korean">Korean (한국어)</option>
                                <option value="Hindi">Hindi (हिन्दी)</option>
                              </select>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Submit Action */}
                      <div className="pt-4">
                        <button
                          type="submit"
                          disabled={isProcessing || !notionStatus.isConfigured}
                          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-6 rounded-xl shadow-md transition flex items-center justify-center space-x-2 cursor-pointer active:scale-98 disabled:opacity-50 disabled:cursor-not-allowed"
                          id="submit-pipeline-btn"
                        >
                          {isProcessing ? (
                            <>
                              <RefreshCw className="h-5 w-5 animate-spin" />
                              <span>Processing ETL Pipeline...</span>
                            </>
                          ) : (
                            <>
                              <RefreshCw className="h-5 w-5" />
                              <span>Trigger ETL Pipeline</span>
                            </>
                          )}
                        </button>
                        {!notionStatus.isConfigured && (
                          <p className="text-center text-xs text-amber-600 mt-2 font-medium">
                            ⚠️ Notion Credentials must be set by the Administrator before running the pipeline.
                          </p>
                        )}
                      </div>
                    </form>
                  </div>

                  {/* Right Column - Status Tracker & Events */}
                  <div className="space-y-8">
                    {/* Pipeline Visualizer */}
                    <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-6 space-y-6">
                      <h3 className="font-display font-bold text-lg text-slate-900 flex items-center space-x-2">
                        <Layers className="h-5 w-5 text-blue-600" />
                        <span>Pipeline Execution Tracker</span>
                      </h3>

                      <div className="space-y-5 relative pl-4 border-l border-slate-200">
                        {pipelineSteps.map((step) => (
                          <div key={step.id} className="relative">
                            <div className="absolute -left-[25px] top-1">
                              {step.status === 'completed' && (
                                <div className="bg-emerald-500 text-white rounded-full p-0.5 border-4 border-white shadow-xs">
                                  <CheckCircle className="h-3.5 w-3.5" />
                                </div>
                              )}
                              {step.status === 'running' && (
                                <div className="bg-blue-600 text-white rounded-full p-0.5 border-4 border-white shadow-xs animate-pulse">
                                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                                </div>
                              )}
                              {step.status === 'failed' && (
                                <div className="bg-red-500 text-white rounded-full p-0.5 border-4 border-white shadow-xs">
                                  <XCircle className="h-3.5 w-3.5" />
                                </div>
                              )}
                              {step.status === 'idle' && (
                                <div className="bg-slate-200 text-slate-400 rounded-full p-1 border-4 border-white shadow-xs">
                                  <div className="h-2 w-2 rounded-full bg-slate-400"></div>
                                </div>
                              )}
                            </div>

                            <div className="text-xs">
                              <div className="flex items-center justify-between">
                                <span className="font-semibold text-slate-900">{step.name}</span>
                                <span className={`text-[10px] uppercase font-bold tracking-wider ${
                                  step.status === 'completed' ? 'text-emerald-600' :
                                  step.status === 'running' ? 'text-blue-600' :
                                  step.status === 'failed' ? 'text-red-500' : 'text-slate-400'
                                }`}>
                                  {step.status}
                                </span>
                              </div>
                              <p className="text-slate-500 text-[11px] mt-0.5">{step.description}</p>
                              <p className={`text-[11px] font-mono mt-1 ${
                                step.status === 'running' ? 'text-blue-600 font-medium' : 'text-slate-400'
                              }`}>
                                {step.message}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* System Event Stream (ONLY visible to Admin user) */}
                      {isAdmin && pipelineLogs.length > 0 && (
                        <div className="space-y-2 pt-2 border-t border-slate-100">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-slate-700 block">System Event Stream</span>
                            <span className="text-[9px] font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded uppercase tracking-wider">
                              Admin Monitor
                            </span>
                          </div>
                          <div className="bg-slate-900 rounded-xl p-3 h-40 overflow-y-auto font-mono text-[10px] text-slate-300 space-y-1 scrollbar-thin">
                            {pipelineLogs.map((log, index) => (
                              <div key={index} className="leading-relaxed">
                                {log.includes('CRITICAL') ? (
                                  <span className="text-red-400">{log}</span>
                                ) : log.includes('Transform') ? (
                                  <span className="text-amber-300">{log}</span>
                                ) : log.includes('Load') ? (
                                  <span className="text-emerald-300">{log}</span>
                                ) : (
                                  <span>{log}</span>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Success Results */}
                    <AnimatePresence>
                      {result && (
                        <motion.div
                          initial={{ opacity: 0, scale: 0.95 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.95 }}
                          className="bg-emerald-50 border-2 border-emerald-200 rounded-2xl shadow-lg p-6 space-y-6"
                          id="success-result-panel"
                        >
                          <div className="flex items-center space-x-3">
                            <div className="bg-emerald-500 text-white p-2 rounded-xl">
                              <CheckCircle className="h-6 w-6" />
                            </div>
                            <div>
                              <span className="text-xs font-semibold text-emerald-800 uppercase tracking-wider block">
                                Ingestion Success
                              </span>
                              <h4 className="font-display font-extrabold text-slate-900 text-lg">
                                Notion Page Loaded
                              </h4>
                            </div>
                          </div>

                          <hr className="border-emerald-100" />

                          <div className="space-y-1.5">
                            <span className="text-xs font-semibold text-slate-500">Document Title</span>
                            <p className="font-semibold text-slate-900 text-sm leading-tight">{result.title}</p>
                          </div>

                          <div className="grid grid-cols-2 gap-3 text-xs bg-white/70 rounded-xl p-3 border border-emerald-100/50">
                            <div>
                              <span className="text-slate-400 block">Original Count</span>
                              <span className="font-semibold font-mono text-slate-800">{result.originalWordCount} words</span>
                            </div>
                            <div>
                              <span className="text-slate-400 block">Ingested Count</span>
                              <span className="font-semibold font-mono text-slate-800">{result.finalWordCount} words</span>
                            </div>
                            <div className="pt-2 border-t border-slate-100 col-span-2 flex justify-between">
                              <span className="text-slate-400">Reading Time:</span>
                              <span className="font-semibold text-slate-800">{result.metadata?.readingTime}</span>
                            </div>
                          </div>

                          {result.metadata?.keywords && (
                            <div className="space-y-1.5">
                              <span className="text-xs font-semibold text-slate-500 block">Ingested Keywords</span>
                              <div className="flex flex-wrap gap-1.5">
                                {result.metadata.keywords.map((tag) => (
                                  <span
                                    key={tag}
                                    className="px-2 py-0.5 bg-emerald-100 text-emerald-800 text-[10px] font-semibold rounded-md border border-emerald-200/50"
                                  >
                                    #{tag.toLowerCase()}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}

                          <div className="pt-2">
                            <a
                              href={result.notionPageUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-3 px-6 rounded-xl shadow-md transition flex items-center justify-center space-x-2"
                              id="open-notion-btn"
                            >
                              <ExternalLink className="h-4.5 w-4.5" />
                              <span>Open Page in Notion</span>
                            </a>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>
              </div>
            )}

            {/* ------------------------- TAB 2: ADMIN MANAGER PANEL ------------------------- */}
            {activeTab === 'admin' && isAdmin && (
              <div className="space-y-8 animate-fade-in">
                {/* Admin Header */}
                <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                  <div className="flex items-center space-x-3">
                    <div className="bg-blue-50 text-blue-600 p-2.5 rounded-xl border border-blue-100">
                      <Shield className="h-6 w-6" />
                    </div>
                    <div>
                      <h2 className="font-display font-extrabold text-xl text-slate-900 tracking-tight">
                        ETL Website Manager Panel
                      </h2>
                      <p className="text-xs text-slate-500">
                        Securely manage environment parameters, keyword replacement rules, and authorize users who can log in.
                      </p>
                    </div>
                  </div>

                  {/* Sub-tab selection row */}
                  <div className="flex flex-wrap gap-1 bg-slate-100 p-1 rounded-xl self-start md:self-auto">
                    <button
                      onClick={() => setAdminActiveSubTab('connections')}
                      className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer flex items-center space-x-1.5 ${
                        adminActiveSubTab === 'connections' ? 'bg-white text-blue-600 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      <Key className="h-3.5 w-3.5" />
                      <span>Connections</span>
                    </button>
                    <button
                      onClick={() => setAdminActiveSubTab('access')}
                      className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer flex items-center space-x-1.5 ${
                        adminActiveSubTab === 'access' ? 'bg-white text-blue-600 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      <Mail className="h-3.5 w-3.5" />
                      <span>Access List</span>
                    </button>
                    <button
                      onClick={() => setAdminActiveSubTab('keywords')}
                      className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer flex items-center space-x-1.5 ${
                        adminActiveSubTab === 'keywords' ? 'bg-white text-blue-600 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      <span>Keywords Replacement</span>
                    </button>
                  </div>
                </div>

                {/* Feedback Banners */}
                {adminSuccessMsg && (
                  <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded-xl flex items-center space-x-2 animate-pulse">
                    <CheckCircle className="h-4 w-4" />
                    <span className="font-medium">{adminSuccessMsg}</span>
                  </div>
                )}
                {adminErrMsg && (
                  <div className="p-3 bg-red-50 border border-red-200 text-red-800 text-xs rounded-xl flex items-center space-x-2">
                    <XCircle className="h-4 w-4" />
                    <span className="font-medium">{adminErrMsg}</span>
                  </div>
                )}

                {/* Sub Tab Panel Content */}
                <div className="grid grid-cols-1 gap-8">
                  
                  {/* SUB-TAB 1: CONNECTIONS */}
                  {adminActiveSubTab === 'connections' && (
                    <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-6 sm:p-8 space-y-6">
                      <div>
                        <h3 className="font-display font-bold text-lg text-slate-900 mb-1 flex items-center space-x-2">
                          <Key className="h-5 w-5 text-blue-600" />
                          <span>Notion Target & Gemini AI Secrets Configuration</span>
                        </h3>
                        <p className="text-xs text-slate-500">
                          These credentials act as the backend defaults for the website. Standard users will use these connections securely behind the proxy, without exposing keys to their browser.
                        </p>
                      </div>

                      <form onSubmit={handleSaveConnections} className="space-y-5">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                          
                          {/* Notion API Key */}
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <label className="text-xs font-semibold text-slate-700" htmlFor="admin-notion-key">
                                Notion Secret API Key
                              </label>
                              <span className="text-[10px] bg-slate-100 text-slate-500 font-mono px-1 rounded">Default Override</span>
                            </div>
                            <div className="relative rounded-lg shadow-xs">
                              <input
                                type={showAdminNotionKey ? 'text' : 'password'}
                                id="admin-notion-key"
                                placeholder="secret_xxxxxxxxxxxxxxxxxxxxxxxxxx"
                                value={adminNotionKey}
                                onChange={(e) => setAdminNotionKey(e.target.value)}
                                className="block w-full px-3 py-2.5 bg-slate-50 border border-slate-300 rounded-lg focus:bg-white focus:ring-2 focus:ring-blue-500 outline-hidden transition text-slate-800 text-xs font-mono"
                              />
                              <button
                                type="button"
                                onClick={() => setShowAdminNotionKey(!showAdminNotionKey)}
                                className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600"
                              >
                                {showAdminNotionKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                              </button>
                            </div>
                          </div>

                          {/* Notion Parent URL or ID */}
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <label className="text-xs font-semibold text-slate-700" htmlFor="admin-notion-parent">
                                Notion Parent Page ID or URL
                              </label>
                              <span className="text-[10px] bg-slate-100 text-slate-500 font-mono px-1 rounded">Default Override</span>
                            </div>
                            <input
                              type="text"
                              id="admin-notion-parent"
                              placeholder="https://www.notion.so/your-parent-page-id"
                              value={adminNotionParent}
                              onChange={(e) => setAdminNotionParent(e.target.value)}
                              className="block w-full px-3 py-2.5 bg-slate-50 border border-slate-300 rounded-lg focus:bg-white focus:ring-2 focus:ring-blue-500 outline-hidden transition text-slate-800 text-xs font-mono"
                            />
                          </div>

                          {/* Gemini API Key */}
                          <div className="space-y-2 md:col-span-2">
                            <div className="flex items-center justify-between">
                              <label className="text-xs font-semibold text-slate-700" htmlFor="admin-gemini-key">
                                Gemini AI API Key
                              </label>
                              <span className="text-[10px] bg-amber-50 text-amber-700 font-semibold px-1 rounded">Secure Cloud Override</span>
                            </div>
                            <div className="relative rounded-lg shadow-xs">
                              <input
                                type={showAdminGeminiKey ? 'text' : 'password'}
                                id="admin-gemini-key"
                                placeholder="AIzaSyXXXXXXXXXXXXXXXXXXXXXXXX"
                                value={adminGeminiKey}
                                onChange={(e) => setAdminGeminiKey(e.target.value)}
                                className="block w-full px-3 py-2.5 bg-slate-50 border border-slate-300 rounded-lg focus:bg-white focus:ring-2 focus:ring-blue-500 outline-hidden transition text-slate-800 text-xs font-mono"
                              />
                              <button
                                type="button"
                                onClick={() => setShowAdminGeminiKey(!showAdminGeminiKey)}
                                className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600"
                              >
                                {showAdminGeminiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                              </button>
                            </div>
                            <p className="text-[10px] text-slate-400">
                              Entering a Gemini API key here overrides the server container's default environment key, allowing custom billing and consumption limit controls.
                            </p>
                          </div>
                        </div>

                        <div className="pt-4 flex justify-end">
                          <button
                            type="submit"
                            className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-5 rounded-xl shadow-xs text-xs transition cursor-pointer"
                          >
                            Save Connection Settings
                          </button>
                        </div>
                      </form>
                    </div>
                  )}

                  {/* SUB-TAB 2: ACCESS CONTROL */}
                  {adminActiveSubTab === 'access' && (
                    <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-6 sm:p-8 space-y-6">
                      <div>
                        <h3 className="font-display font-bold text-lg text-slate-900 mb-1 flex items-center space-x-2">
                          <Mail className="h-5 w-5 text-blue-600" />
                          <span>Login Authorization & Users Management</span>
                        </h3>
                        <p className="text-xs text-slate-500">
                          Register the email addresses of users who are allowed to log in and trigger the pipeline. Users not listed here will be blocked immediately upon Google OAuth completion.
                        </p>
                      </div>

                      {/* Add email form */}
                      <form onSubmit={handleAddAllowedEmail} className="flex gap-2 max-w-md">
                        <input
                          type="email"
                          required
                          placeholder="user@gmail.com"
                          value={newAllowedEmail}
                          onChange={(e) => setNewAllowedEmail(e.target.value)}
                          className="block w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:ring-2 focus:ring-blue-500 outline-hidden transition text-slate-800 text-xs"
                        />
                        <button
                          type="submit"
                          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl text-xs font-semibold shrink-0 transition cursor-pointer flex items-center space-x-1"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          <span>Add Email</span>
                        </button>
                      </form>

                      {/* Authorized users list */}
                      <div className="space-y-3">
                        <span className="text-xs font-bold text-slate-700 block">Authorized Accounts</span>
                        
                        <div className="border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-100 max-w-2xl bg-slate-50/50">
                          {/* Primary Admin (non removable) */}
                          <div className="p-3 flex items-center justify-between text-xs">
                            <div className="flex items-center space-x-2">
                              <div className="h-2 w-2 rounded-full bg-blue-500"></div>
                              <span className="font-medium text-slate-900">{adminConfig.adminEmail || user?.email}</span>
                            </div>
                            <span className="px-2 py-0.5 bg-blue-50 text-blue-700 text-[9px] font-extrabold uppercase rounded border border-blue-100">
                              Primary Owner / Admin
                            </span>
                          </div>

                          {/* Authorized emails */}
                          {adminConfig.allowedEmails && adminConfig.allowedEmails.length > 0 ? (
                            adminConfig.allowedEmails.map((email) => (
                              <div key={email} className="p-3 flex items-center justify-between text-xs bg-white">
                                <div className="flex items-center space-x-2">
                                  <div className="h-2 w-2 rounded-full bg-slate-400"></div>
                                  <span className="text-slate-800 font-mono">{email}</span>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => handleRemoveAllowedEmail(email)}
                                  className="text-slate-400 hover:text-red-600 p-1 rounded-lg hover:bg-red-50 transition"
                                  title="Revoke Permission"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            ))
                          ) : (
                            <div className="p-4 text-center text-xs text-slate-400 bg-white">
                              No additional emails configured. Only the Primary Administrator can log in.
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* SUB-TAB 3: KEYWORDS REPLACEMENT */}
                  {adminActiveSubTab === 'keywords' && (
                    <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-6 sm:p-8 space-y-6">
                      <div>
                        <h3 className="font-display font-bold text-lg text-slate-900 mb-1 flex items-center space-x-2">
                          <RefreshCw className="h-5 w-5 text-blue-600" />
                          <span>Custom Document Keyword Replacements</span>
                        </h3>
                        <p className="text-xs text-slate-500">
                          Configure terms to search for and replace globally during the ingestion extraction. For example, replace bracketed notes like <b>"[footnote]"</b> with <b>"[reference]"</b>.
                        </p>
                      </div>

                      {/* Add rule form */}
                      <form onSubmit={handleAddKeywordRule} className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-2xl">
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-slate-600 block">Find Keyword / Phrase</label>
                          <input
                            type="text"
                            required
                            placeholder="e.g. [footnote]"
                            value={newKeywordFind}
                            onChange={(e) => setNewKeywordFind(e.target.value)}
                            className="block w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:ring-2 focus:ring-blue-500 outline-hidden transition text-slate-800 text-xs font-mono"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-slate-600 block">Replace With</label>
                          <input
                            type="text"
                            placeholder="e.g. [reference]"
                            value={newKeywordReplace}
                            onChange={(e) => setNewKeywordReplace(e.target.value)}
                            className="block w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:ring-2 focus:ring-blue-500 outline-hidden transition text-slate-800 text-xs font-mono"
                          />
                        </div>
                        <div className="flex items-end">
                          <button
                            type="submit"
                            className="bg-blue-600 hover:bg-blue-700 text-white w-full py-2 rounded-xl text-xs font-semibold transition cursor-pointer flex items-center justify-center space-x-1 h-[34px]"
                          >
                            <Plus className="h-3.5 w-3.5" />
                            <span>Add Rule</span>
                          </button>
                        </div>
                      </form>

                      {/* Active rules list */}
                      <div className="space-y-3">
                        <span className="text-xs font-bold text-slate-700 block">Active Replacement Rules</span>
                        
                        <div className="border border-slate-200 rounded-xl overflow-hidden bg-slate-50/50 max-w-2xl divide-y divide-slate-100">
                          {adminConfig.replaceKeywords && adminConfig.replaceKeywords.length > 0 ? (
                            adminConfig.replaceKeywords.map((rule) => (
                              <div key={rule.find} className="p-3 flex items-center justify-between text-xs bg-white">
                                <div className="flex items-center space-x-3 text-slate-800">
                                  <span className="font-mono bg-slate-100 px-2 py-1 rounded border border-slate-200/50 text-[11px] text-slate-700">
                                    "{rule.find}"
                                  </span>
                                  <ArrowRight className="h-3.5 w-3.5 text-slate-400" />
                                  <span className="font-mono bg-blue-50 px-2 py-1 rounded border border-blue-100 text-[11px] text-blue-700 font-medium">
                                    "{rule.replace || 'empty'}"
                                  </span>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => handleRemoveKeywordRule(rule.find)}
                                  className="text-slate-400 hover:text-red-600 p-1 rounded-lg hover:bg-red-50 transition"
                                  title="Delete Rule"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            ))
                          ) : (
                            <div className="p-4 text-center text-xs text-slate-400 bg-white">
                              No keyword replacement rules active.
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
