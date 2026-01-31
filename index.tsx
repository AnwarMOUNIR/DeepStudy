import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import { createClient } from "@supabase/supabase-js";
import { 
  FileAudio, 
  FileText, 
  Brain, 
  CheckCircle, 
  Loader2, 
  Download, 
  BookOpen, 
  Trash2,
  Layers,
  Zap,
  Globe,
  BarChart,
  Activity,
  Search,
  PenTool,
  ShieldCheck,
  Lock,
  User,
  LogOut,
  Mail,
  Key,
  ShieldAlert,
  History as HistoryIcon,
  Settings,
  Cloud,
  ChevronRight,
  Clock,
  Database,
  Wifi,
  WifiOff,
  AlertTriangle,
  ExternalLink,
  RefreshCcw,
  CloudOff,
  CloudDownload,
  Plus,
  ArrowLeft,
  BookMarked
} from "lucide-react";

// --- Configuration ---

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.warn("⚠️ Supabase Credentials Missing! Check your Vercel Environment Variables.");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// --- Model Configuration ---

// The "Architect" Model: Must have HUGE context window (1M+) to read all PDFs at once.
const ARCHITECT_MODEL = "gemini-2.5-flash"; 

// The "Synthesizer" Pool: Rotates to avoid Rate Limits.
// Gemma models are placed last as fallbacks/infinite-quota options.
// The "A-Team": Rotates between Flash models to keep you undetected and fast.
const FLASH_POOL = [
  "gemini-2.5-flash",       
  "gemini-flash-latest",    
  "gemini-2.5-flash-lite", 
  "gemini-2.0-flash"        
];

// The "Shadow": Only activates if the A-Team fails.
const FALLBACK_MODEL = "gemma-3-27b-it";

// --- Types ---

interface UserProfile {
  id: string;
  email: string;
  name: string;
  isCloudEnabled: boolean;
}

interface FileData {
  file: File;
  base64: string;
  mimeType: string;
}

interface StudyModule {
  id: string;
  title: string;
  description: string;
  hasAudio: boolean;
  status: 'pending' | 'processing' | 'completed';
  subStep?: 'analyzing' | 'cross-referencing' | 'drafting' | 'finalizing' | 'retrying' | 'saving';
  content?: string;
  usedModel?: string; // Track which model wrote this section
}

interface NotebookSection {
  id: string;
  title: string;
  content: string;
  created_at: string;
}

type Language = 'en' | 'fr';
type Depth = 'standard' | 'comprehensive';
type ViewMode = 'dashboard' | 'generating' | 'viewing';

// --- Utils ---

const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = (error) => reject(error);
  });
};

const triggerDownload = (filename: string, content: string) => {
  const element = document.createElement('a');
  element.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(content));
  element.setAttribute('download', filename);
  element.style.display = 'none';
  document.body.appendChild(element);
  element.click();
  document.body.removeChild(element);
};

const formatTextToHtml = (text: string) => {
  return text
    .replace(/^# (.*$)/gim, '<h1 class="text-5xl font-black text-white mb-12 tracking-tighter leading-[1]">$1</h1>')
    .replace(/^## (.*$)/gim, '<h2 class="text-3xl font-black text-indigo-500 mb-8 mt-16 tracking-tight">$1</h2>')
    .replace(/^### (.*$)/gim, '<h3 class="text-xl font-black text-purple-400 mb-6 mt-10 tracking-tight">$1</h3>')
    .replace(/\*\*(.*?)\*\*/g, '<strong class="text-white font-black">$1</strong>')
    .replace(/^[*-] (.*$)/gim, '<div class="flex gap-4 mb-6 items-start"><span class="text-indigo-600 mt-1.5 flex-shrink-0 text-lg font-black">/</span><span class="text-slate-300 font-medium text-lg">$1</span></div>');
};

async function withRetry<T>(fn: () => Promise<T>, onRetry?: () => void, maxRetries = 4): Promise<T> {
  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      return await fn();
    } catch (err: any) {
      const isRateLimit = err?.message?.includes("429") || err?.status === 429 || err?.message?.includes("quota");
      if (isRateLimit && attempt < maxRetries - 1) {
        attempt++;
        const delay = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
        if (onRetry) onRetry();
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      throw err;
    }
  }
  throw new Error("Maximum retries reached");
}

const AuthService = {
  isMock: SUPABASE_ANON_KEY === "missing-anon-key-placeholder",
  login: async (email: string, pass: string): Promise<UserProfile> => {
    if (AuthService.isMock) return { id: 'mock-id', email, name: email.split('@')[0], isCloudEnabled: false };
    const { data, error } = await supabase.auth.signInWithPassword({ email, password: pass });
    if (error) throw error;
    return { id: data.user.id, email: data.user.email!, name: data.user.user_metadata?.full_name || email.split('@')[0], isCloudEnabled: true };
  },
  signup: async (email: string, pass: string, name: string): Promise<UserProfile> => {
    if (AuthService.isMock) return { id: 'mock-id', email, name, isCloudEnabled: false };
    const { data, error } = await supabase.auth.signUp({ email: email.trim(), password: pass, options: { data: { full_name: name } } });
    if (error) throw error;
    if (!data.user) throw new Error("Signup failed");
    return { id: data.user.id, email: data.user.email!, name, isCloudEnabled: true };
  }
};

// --- Sub-Components ---

const DashboardHeader = ({ user, isSyncing, handleLogout, onNewSection }: any) => (
  <header className="px-10 py-6 flex items-center justify-between border-b border-white/5 bg-black/30 backdrop-blur-2xl sticky top-0 z-50">
    <div className="flex items-center gap-4 cursor-pointer" onClick={onNewSection}>
      <div className="p-2.5 bg-gradient-to-br from-indigo-600 to-purple-700 rounded-xl shadow-lg">
        <Brain className="w-6 h-6 text-white" />
      </div>
      <div>
        <h1 className="text-2xl font-black text-white tracking-tighter leading-none">DeepStudy</h1>
        <div className="flex items-center gap-2 mt-1">
           <div className={`w-1.5 h-1.5 rounded-full ${user?.isCloudEnabled ? 'bg-green-500' : 'bg-amber-500'} animate-pulse`}></div>
           <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">{user?.isCloudEnabled ? 'Cloud Neural Bank Active' : 'Offline Mode'}</span>
        </div>
      </div>
    </div>

    <div className="flex items-center gap-8">
      {isSyncing && (
        <div className="flex items-center gap-2 px-3 py-1 bg-indigo-500/10 border border-indigo-500/20 rounded-full">
          <Cloud className="w-3 h-3 text-indigo-400 animate-bounce" />
          <span className="text-[8px] font-black text-indigo-400 uppercase tracking-widest">Auto-Saving...</span>
        </div>
      )}
      <div className="hidden lg:flex items-center gap-5 pr-8 border-r border-white/5">
        <button onClick={onNewSection} className="px-6 py-2.5 bg-white text-black rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-200 transition-all flex items-center gap-2">
          <Plus className="w-3 h-3" /> New Neural Section
        </button>
      </div>
      <div className="flex items-center gap-5">
        <div className="text-right">
           <p className="text-xs font-black text-white leading-none mb-1">{user?.name}</p>
           <p className="text-[9px] text-slate-600 font-black uppercase tracking-widest">{user?.email}</p>
        </div>
        <button onClick={handleLogout} className="w-11 h-11 bg-slate-900 border border-white/5 rounded-2xl flex items-center justify-center text-slate-500 hover:text-red-400 hover:border-red-400/30 transition-all active:scale-95">
          <LogOut className="w-5 h-5" />
        </button>
      </div>
    </div>
  </header>
);

// --- Main App ---

const App = () => {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
  const [authLoading, setAuthLoading] = useState(false);
  const [authForm, setAuthForm] = useState({ email: '', password: '', name: '' });

  const [audioDataList, setAudioDataList] = useState<FileData[]>([]);
  const [pdfDataList, setPdfDataList] = useState<FileData[]>([]);
  const [depth, setDepth] = useState<Depth>('standard');
  const [viewMode, setViewMode] = useState<ViewMode>('dashboard');
  
  const [isOrchestrating, setIsOrchestrating] = useState(false);
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  const [progressStep, setProgressStep] = useState<string>("");
  const [modules, setModules] = useState<StudyModule[]>([]);
  const [notebookSections, setNotebookSections] = useState<NotebookSection[]>([]);
  const [selectedSection, setSelectedSection] = useState<NotebookSection | null>(null);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('deepstudy_user');
    if (saved) {
      const parsedUser = JSON.parse(saved);
      if (parsedUser.id === 'mock-id' && !AuthService.isMock) {
        localStorage.removeItem('deepstudy_user');
        setUser(null);
      } else {
        setUser(parsedUser);
        if (parsedUser.isCloudEnabled && parsedUser.id !== 'mock-id') fetchNotebooks(parsedUser.id);
      }
    }
  }, []);

  const fetchNotebooks = async (userId: string) => {
    if (AuthService.isMock || userId === 'mock-id') return;
    setIsHistoryLoading(true);
    try {
      const { data, error: dbErr } = await supabase
        .from('study_modules')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });
      
      if (dbErr) throw dbErr;
      if (data) setNotebookSections(data);
    } catch (err: any) {
      console.error("Fetch Failure:", err);
      setError("Sync Error: " + (err.message || "Cloud access failure."));
    } finally {
      setIsHistoryLoading(false);
    }
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthLoading(true);
    setError(null);
    try {
      let userData;
      if (authMode === 'login') userData = await AuthService.login(authForm.email, authForm.password);
      else userData = await AuthService.signup(authForm.email, authForm.password, authForm.name);
      setUser(userData);
      localStorage.setItem('deepstudy_user', JSON.stringify(userData));
      if (userData.isCloudEnabled && userData.id !== 'mock-id') fetchNotebooks(userData.id);
    } catch (err: any) {
      setError(err.message || "Access denied.");
    } finally {
      setAuthLoading(false);
    }
  };

  // --- ENGINE LOGIC START ---
const startMastery = async () => {
    if (audioDataList.length === 0 && pdfDataList.length === 0) {
      setError("Materials required. Please upload Audio or PDFs.");
      return;
    }
    
    setViewMode('generating');
    setIsOrchestrating(true);
    setError(null);
    setProgressStep(`Phase 1: Neural Mapping...`);

    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const commonFiles = [...audioDataList, ...pdfDataList].map(f => ({
      inlineData: { mimeType: f.mimeType, data: f.base64 }
    }));

    try {
      const count = depth === 'comprehensive' ? 12 : 6;
      
      // --- PHASE 1: MAPPING (Always Architect) ---
      const mapperResponse: GenerateContentResponse = await withRetry<GenerateContentResponse>(() => ai.models.generateContent({
        model: ARCHITECT_MODEL,
        contents: {
          parts: [{ text: `Divide the course into ${count} sections based on the provided materials. Return strictly JSON.` }, ...commonFiles]
        },
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                title: { type: Type.STRING },
                description: { type: Type.STRING },
                hasAudio: { type: Type.BOOLEAN }
              },
              required: ["id", "title", "description", "hasAudio"]
            }
          }
        }
      }));

      const mapped = JSON.parse(mapperResponse.text) as StudyModule[];
      setModules(mapped.map(m => ({ ...m, status: 'pending' })));
      setIsOrchestrating(false);
      setIsSynthesizing(true);

      // --- PHASE 2: SILENT FALLBACK SYNTHESIS ---
      for (let i = 0; i < mapped.length; i++) {
        const current = mapped[i];
        
        // 1. Select Primary Model (Rotation)
        const primaryModel = FLASH_POOL[i % FLASH_POOL.length];
        let activeModel = primaryModel;
        let finalContent = "";

        setModules(prev => prev.map(m => m.id === current.id ? { ...m, status: 'processing', subStep: 'analyzing' } : m));
        
        // Discreet UI: Just says "Synthesizing..." - doesn't reveal which model
        setProgressStep(`Synthesizing Node-${i+1}...`); 

        try {
            // Attempt 1: Primary Flash Model
            const limitInstruction = activeModel.includes("2.0") ? "Keep output under 8000 tokens." : "Provide comprehensive detail.";
            
            const response = await withRetry(() => ai.models.generateContent({
                model: activeModel,
                contents: { parts: [{ text: `SYNTHESIZE SECTION: ${current.title}. ${limitInstruction} Use Markdown/LaTeX.`, }, ...commonFiles] }
            }));
            finalContent = response.text;

        } catch (primaryError) {
            // SILENT FAILOVER: Only logs to console (invisible to user)
            console.warn(`[Silent Swap] ${activeModel} failed. Swapping to ${FALLBACK_MODEL}.`, primaryError);
            
            activeModel = FALLBACK_MODEL; // Switch tracker to Gemma
            
            // Attempt 2: Fallback Gemma Model
            // We use 'catch' here too just in case even Gemma fails, so the app doesn't crash completely.
            const fallbackResponse = await withRetry(() => ai.models.generateContent({
                model: FALLBACK_MODEL,
                contents: { parts: [{ text: `SYNTHESIZE SECTION: ${current.title}. Detailed notes. Use Markdown/LaTeX.`, }, ...commonFiles] }
            }));
            finalContent = fallbackResponse.text;
        }

        // Save Result
        if (user?.isCloudEnabled && user.id !== 'mock-id') {
          setIsSyncing(true);
          await supabase.from('study_modules').insert({
            user_id: user.id,
            title: current.title,
            content: finalContent,
            has_audio: current.hasAudio
          });
          setIsSyncing(false);
        }

        setModules(prev => prev.map(m => m.id === current.id ? { ...m, status: 'completed', content: finalContent, usedModel: activeModel } : m));
        await new Promise(r => setTimeout(r, 800));
      }
      setIsSynthesizing(false);
      setProgressStep("Course DNA Mapped Successfully.");

    } catch (err: any) {
      console.error(err);
      setError("Engine Interrupted.");
      setIsOrchestrating(false);
      setIsSynthesizing(false);
    }
  };
  // --- ENGINE LOGIC END ---

  const handleNotebookClick = (section: NotebookSection) => {
    setSelectedSection(section);
    setViewMode('viewing');
  };

  useEffect(() => {
    if (viewMode === 'viewing' || modules.some(m => m.content)) {
      if ((window as any).MathJax?.typesetPromise) {
        (window as any).MathJax.typesetPromise();
      }
    }
  }, [selectedSection, modules, viewMode]);

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-slate-950">
        <div className="w-full max-w-md bg-slate-900 p-12 rounded-[3rem] border border-white/5 shadow-2xl">
          <div className="flex flex-col items-center mb-12">
            <div className="p-5 bg-indigo-600 rounded-3xl mb-6"><Brain className="w-12 h-12 text-white" /></div>
            <h1 className="text-5xl font-black text-white tracking-tighter mb-3">DeepStudy</h1>
            <p className="text-slate-500 font-semibold text-xs uppercase tracking-widest">Neural Academic Engine</p>
          </div>
          <form onSubmit={handleAuth} className="space-y-6">
            {authMode === 'signup' && (
              <input required type="text" placeholder="Full Name" className="w-full bg-black/40 border border-slate-800 rounded-2xl py-5 px-6 text-white outline-none" value={authForm.name} onChange={e => setAuthForm({...authForm, name: e.target.value})} />
            )}
            <input required type="email" placeholder="Email" className="w-full bg-black/40 border border-slate-800 rounded-2xl py-5 px-6 text-white outline-none" value={authForm.email} onChange={e => setAuthForm({...authForm, email: e.target.value})} />
            <input required type="password" placeholder="Passkey" className="w-full bg-black/40 border border-slate-800 rounded-2xl py-5 px-6 text-white outline-none" value={authForm.password} onChange={e => setAuthForm({...authForm, password: e.target.value})} />
            <button disabled={authLoading} className="w-full bg-white text-black py-5 rounded-2xl font-black text-xl hover:bg-slate-200 transition-all flex items-center justify-center gap-3">
              {authLoading ? <Loader2 className="w-6 h-6 animate-spin" /> : <Lock className="w-5 h-5" />}
              {authMode === 'login' ? 'Access Terminal' : 'Establish Link'}
            </button>
          </form>
          <button onClick={() => setAuthMode(authMode === 'login' ? 'signup' : 'login')} className="w-full mt-10 text-slate-600 hover:text-white text-[10px] font-black uppercase tracking-widest">
            {authMode === 'login' ? 'Request System Entry' : 'Return to Login'}
          </button>
          {error && <div className="mt-8 p-4 bg-red-500/10 border border-red-500/20 rounded-2xl text-red-500 text-center text-[10px] font-black uppercase tracking-widest">{error}</div>}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-slate-100 font-sans">
      <DashboardHeader 
        user={user} 
        isSyncing={isSyncing} 
        handleLogout={() => { localStorage.removeItem('deepstudy_user'); setUser(null); }} 
        onNewSection={() => { 
            // --- FIX: CLEAR EVERYTHING ON RESET ---
            setViewMode('dashboard'); 
            setModules([]); 
            setAudioDataList([]);
            setPdfDataList([]);
        }} 
      />

      <div className="flex">
        {/* Main Content Area */}
        <main className="flex-grow p-10 min-h-[calc(100vh-100px)]">
          {viewMode === 'dashboard' && (
            <div className="max-w-4xl mx-auto py-20 animate-in fade-in slide-in-from-bottom-10 duration-700">
              <span className="text-indigo-500 text-[10px] font-black uppercase tracking-[0.5em] mb-4 block">Command Center</span>
              <h2 className="text-7xl font-black text-white tracking-tighter mb-8 leading-[0.85]">Map Course DNA.</h2>
              <p className="text-xl text-slate-500 font-medium mb-16 max-w-2xl">Upload lecture audio and PDF materials to establish a new persistent Notebook Section.</p>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-16">
                <div className="bg-slate-900/40 rounded-[3rem] p-10 border border-white/5 hover:border-indigo-500/40 transition-all relative group overflow-hidden">
                  <input type="file" accept="audio/*" multiple className="absolute inset-0 opacity-0 cursor-pointer z-10" onChange={async e => {
                    const files = Array.from(e.target.files || []) as File[];
                    const bases = await Promise.all(files.map(async f => ({ file: f, base64: await fileToBase64(f), mimeType: f.type })));
                    setAudioDataList(prev => [...prev, ...bases]);
                  }} />
                  <FileAudio className="w-10 h-10 text-indigo-500 mb-6 group-hover:scale-110 transition-transform" />
                  <h3 className="text-2xl font-black text-white">Audio Stream</h3>
                  <p className="text-slate-500 text-xs mt-1">Professor's voice ({audioDataList.length} files)</p>
                </div>
                <div className="bg-slate-900/40 rounded-[3rem] p-10 border border-white/5 hover:border-purple-500/40 transition-all relative group overflow-hidden">
                  <input type="file" accept="application/pdf" multiple className="absolute inset-0 opacity-0 cursor-pointer z-10" onChange={async e => {
                    const files = Array.from(e.target.files || []) as File[];
                    const bases = await Promise.all(files.map(async f => ({ file: f, base64: await fileToBase64(f), mimeType: f.type })));
                    setPdfDataList(prev => [...prev, ...bases]);
                  }} />
                  <BookOpen className="w-10 h-10 text-purple-500 mb-6 group-hover:scale-110 transition-transform" />
                  <h3 className="text-2xl font-black text-white">Visual Matrix</h3>
                  <p className="text-slate-500 text-xs mt-1">Slides & Diagrams ({pdfDataList.length} files)</p>
                </div>
              </div>

              <div className="flex items-center gap-8">
                <div className="flex gap-2 p-1.5 bg-slate-900/50 rounded-2xl border border-white/5">
                  <button onClick={() => setDepth('standard')} className={`px-8 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest ${depth === 'standard' ? 'bg-white text-black' : 'text-slate-600'}`}>Standard</button>
                  <button onClick={() => setDepth('comprehensive')} className={`px-8 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest ${depth === 'comprehensive' ? 'bg-white text-black' : 'text-slate-600'}`}>Deep-Scan</button>
                </div>
                <button onClick={startMastery} className="px-12 py-6 bg-gradient-to-r from-indigo-600 to-purple-700 text-white rounded-3xl text-xl font-black flex items-center gap-4 hover:scale-105 active:scale-95 transition-all shadow-2xl shadow-indigo-600/20">
                  <Zap className="w-6 h-6" /> Initialize Synthesis
                </button>
              </div>
            </div>
          )}

          {viewMode === 'generating' && (
            <div className="max-w-5xl mx-auto space-y-20 py-10">
              <div className="flex items-center justify-between bg-slate-900/40 p-10 rounded-[3rem] border border-white/5">
                <div className="flex items-center gap-6">
                  <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center"><Activity className="w-8 h-8 text-black animate-pulse" /></div>
                  <div>
                    <h2 className="text-3xl font-black text-white tracking-tighter">Active Engine</h2>
                    <p className="text-indigo-500 text-[10px] font-black uppercase tracking-widest animate-pulse">{progressStep}</p>
                  </div>
                </div>
                {!isSynthesizing && (
                   // --- FIX: CLEAR FILES ON RETURN ---
                  <button 
                    onClick={() => {
                        setViewMode('dashboard');
                        setAudioDataList([]);
                        setPdfDataList([]);
                    }} 
                    className="px-8 py-4 bg-slate-800 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-700 transition-colors"
                  >
                    Return to Terminal
                  </button>
                )}
              </div>

              <div className="space-y-16">
                {modules.filter(m => m.content).map((m, idx) => (
                  <section key={m.id} className="bg-slate-900/20 border border-white/5 rounded-[4rem] overflow-hidden animate-in fade-in slide-in-from-bottom-10 duration-500">
                    <div className="px-16 py-10 bg-slate-900 border-b border-white/5 flex items-center justify-between">
                      <h3 className="text-2xl font-black text-white tracking-tighter">Node-0{idx + 1}: {m.title}</h3>
                      <div className="flex items-center gap-2 text-green-500">
                        <Cloud className="w-4 h-4" />
                        <span className="text-[8px] font-black uppercase">Stored via {m.usedModel || "AI"}</span>
                      </div>
                    </div>
                    <div className="p-16 prose-invert prose-2xl max-w-none" dangerouslySetInnerHTML={{ __html: formatTextToHtml(m.content || "") }} />
                  </section>
                ))}
                {isSynthesizing && (
                  <div className="p-40 text-center border border-dashed border-white/5 rounded-[5rem]">
                    <Loader2 className="w-12 h-12 text-indigo-500 animate-spin mx-auto mb-6" />
                    <p className="text-[10px] font-black text-slate-600 uppercase tracking-[0.5em]">Neural Drafting...</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {viewMode === 'viewing' && selectedSection && (
            <div className="max-w-4xl mx-auto py-10 animate-in fade-in duration-500">
              <button onClick={() => setViewMode('dashboard')} className="flex items-center gap-3 text-[10px] font-black text-slate-600 uppercase tracking-widest hover:text-white transition-colors mb-12">
                <ArrowLeft className="w-4 h-4" /> Exit Mastery View
              </button>
              <div className="flex items-center justify-between mb-16">
                <h2 className="text-6xl font-black text-white tracking-tighter">{selectedSection.title}</h2>
                <div className="text-right">
                  <p className="text-[10px] text-indigo-500 font-black uppercase tracking-widest">Historical Mastery</p>
                  <p className="text-xs text-slate-600 font-black mt-1 uppercase tracking-widest">{new Date(selectedSection.created_at).toLocaleString()}</p>
                </div>
              </div>
              <div className="prose-invert prose-2xl max-w-none bg-slate-900/30 p-16 rounded-[4rem] border border-white/5" dangerouslySetInnerHTML={{ __html: formatTextToHtml(selectedSection.content) }} />
              <button onClick={() => triggerDownload(`${selectedSection.title}.md`, selectedSection.content)} className="mt-16 px-10 py-5 bg-white text-black rounded-3xl font-black text-xs uppercase tracking-widest hover:scale-105 transition-all flex items-center gap-4">
                <Download className="w-4 h-4" /> Export MD Transcript
              </button>
            </div>
          )}
        </main>

        {/* Persistent Notebook Sidebar */}
        <aside className="w-96 border-l border-white/5 bg-slate-950 p-10 h-[calc(100vh-100px)] sticky top-[100px] overflow-y-auto">
          <div className="flex items-center justify-between mb-10">
            <h4 className="text-[10px] font-black text-slate-600 uppercase tracking-[0.4em] flex items-center gap-3"><BookMarked className="w-4 h-4" /> Notebook Sections</h4>
            {isHistoryLoading && <Loader2 className="w-3 h-3 text-indigo-500 animate-spin" />}
          </div>

          <div className="space-y-4">
            {notebookSections.length > 0 ? notebookSections.map(section => (
              <div 
                key={section.id} 
                onClick={() => handleNotebookClick(section)}
                className={`group p-6 rounded-3xl border transition-all cursor-pointer ${selectedSection?.id === section.id && viewMode === 'viewing' ? 'bg-indigo-600/10 border-indigo-500/40' : 'bg-slate-900/40 border-white/5 hover:border-white/20'}`}
              >
                <div className="flex items-start justify-between mb-3">
                   <h5 className="text-xs font-black text-white tracking-tight group-hover:text-indigo-400 transition-colors">{section.title}</h5>
                   <ChevronRight className={`w-3.5 h-3.5 transition-all ${selectedSection?.id === section.id && viewMode === 'viewing' ? 'text-indigo-500' : 'text-slate-800'}`} />
                </div>
                <div className="flex items-center gap-2 text-[8px] text-slate-700 font-black uppercase tracking-widest">
                  <Clock className="w-2.5 h-2.5" /> {new Date(section.created_at).toLocaleDateString()}
                </div>
              </div>
            )) : (
              <div className="py-20 text-center space-y-4 opacity-20">
                <Database className="w-10 h-10 mx-auto" />
                <p className="text-[9px] font-black uppercase tracking-widest">No Sections Synced</p>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
};

const root = createRoot(document.getElementById("root")!);
root.render(<App />);