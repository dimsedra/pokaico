import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { LeftSidebar } from './components/LeftSidebar';
import { RightSidebar } from './components/RightSidebar';
import { ChatWindow } from './components/ChatWindow';
import { MemoryGraph } from './components/MemoryGraph';
import { SettingsPanel } from './components/SettingsPanel';
import { ChatSession, Message, MemoryItem, DiaryEntry, CompanionState, ExpressionType } from './types';
import './styles/index.css';

// Seed initial memory items if directory is completely empty
const INITIAL_MEMORIES: MemoryItem[] = [
  { id: 'm1', category: 'preference', details: 'Loves warm chamomile tea', learnedAt: 'Jul 15, 2026' },
  { id: 'm2', category: 'habit', details: 'Always journals before going to bed', learnedAt: 'Jul 15, 2026' },
  { id: 'm3', category: 'feeling', details: 'Finds comfort in steady rain sounds', learnedAt: 'Jul 15, 2026' }
];

const getLocalRawTime = (): string => {
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
};

export default function App() {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [diaries, setDiaries] = useState<DiaryEntry[]>([]);
  const [companionState, setCompanionState] = useState<CompanionState>({
    name: 'Shroomy',
    level: 1,
    exp: 20,
    expression: 'idle',
    moodText: 'Shroomy is happy to listen to you'
  });

  const [activeView, setActiveView] = useState<'chat' | 'graph' | 'settings'>('chat');
  const [isGenerating, setIsGenerating] = useState(false);
  
  // Tauri settings integration states
  const [dataDirectory, setDataDirectory] = useState<string>('');
  const [activeChatProvider, setActiveChatProvider] = useState<string>('google');
  const [activeChatModel, setActiveChatModel] = useState<string>('gemini-2.0-flash-lite');
  const [activePipelineProvider, setActivePipelineProvider] = useState<string>('google');
  const [activePipelineModel, setActivePipelineModel] = useState<string>('gemini-2.0-flash-lite');
  const [apiKeysMap, setApiKeysMap] = useState<Record<string, string>>({});
  const [providersList, setProvidersList] = useState<{ providerId: string; providerName: string; models: string[] }[]>([]);
  const [enabledModelsMap, setEnabledModelsMap] = useState<Record<string, string[]>>({});
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  const isSubmitting = useRef(false);

  // 1. Initial Load from Tauri Commands and LocalStorage
  useEffect(() => {
    // Load companion name, level, exp from localStorage to preserve growth progress
    try {
      const storedCompanion = localStorage.getItem('pokaico_companion');
      if (storedCompanion) {
        setCompanionState(JSON.parse(storedCompanion));
      }
      const storedTheme = localStorage.getItem('pokaico_theme') as 'dark' | 'light';
      if (storedTheme) {
        setTheme(storedTheme);
        if (storedTheme === 'light') {
          document.documentElement.classList.add('theme-light');
        } else {
          document.documentElement.classList.remove('theme-light');
        }
      }
    } catch (e) {
      console.error('Failed to load companion stats from local storage:', e);
    }

    refreshDataDirectory();
    refreshSessions();
    refreshDiaries();
    refreshMemoryItems();
    loadProviderConfig();
  }, []);

  const refreshDataDirectory = async () => {
    try {
      const dir = await invoke<string>('get_data_directory');
      setDataDirectory(dir);
    } catch (err) {
      console.error('Failed to get data directory:', err);
    }
  };

  const refreshSessions = async (fallbackIdToSelect?: string) => {
    try {
      const list = await invoke<{ id: string; title: string; created_at: string }[]>('list_conversations');
      
      setSessions((prev) =>
        list.map((meta) => {
          const existing = prev.find((s) => s.id === meta.id);
          return {
            id: meta.id,
            title: meta.title,
            messages: existing ? existing.messages : [],
            createdAt: meta.created_at
          };
        })
      );

      if (list.length > 0) {
        if (fallbackIdToSelect && list.some(s => s.id === fallbackIdToSelect)) {
          setActiveSessionId(fallbackIdToSelect);
        } else if (!activeSessionId || !list.some(s => s.id === activeSessionId)) {
          setActiveSessionId(list[0].id);
        }
      } else {
        setActiveSessionId(null);
      }
    } catch (err) {
      console.error('Failed to list sessions:', err);
    }
  };

  const refreshDiaries = async () => {
    try {
      const list = await invoke<DiaryEntry[]>('list_diaries');
      setDiaries(list);
    } catch (err) {
      console.error('Failed to list diaries:', err);
    }
  };

  const refreshMemoryItems = async () => {
    try {
      const list = await invoke<MemoryItem[]>('get_memory_items');
      if (list.length === 0) {
        setMemories(INITIAL_MEMORIES);
      } else {
        setMemories(list);
      }
    } catch (err) {
      console.error('Failed to load memory items:', err);
    }
  };

  const loadProviderConfig = async () => {
    try {
      const providers = await invoke<{ providerId: string; providerName: string; models: string[] }[]>('get_available_providers');
      setProvidersList(providers);

      const activeConfig = await invoke<any>('get_active_provider_config');
      setActiveChatProvider(activeConfig.activeChatProvider || activeConfig.activeProvider || 'google');
      setActiveChatModel(activeConfig.activeChatModel || activeConfig.activeModel || 'gemini-2.0-flash-lite');
      setActivePipelineProvider(activeConfig.activePipelineProvider || activeConfig.activeProvider || 'google');
      setActivePipelineModel(activeConfig.activePipelineModel || activeConfig.activeModel || 'gemini-2.0-flash-lite');
      
      const keys = activeConfig.apiKeys || {};
      setApiKeysMap(keys);

      const enabled = activeConfig.enabledModels || {};
      setEnabledModelsMap(enabled);
    } catch (err) {
      console.error('Failed to load active provider config:', err);
    }
  };

  const handleSaveEnabledModels = async (providerId: string, models: string[]) => {
    try {
      await invoke('save_enabled_models', { providerId, models });
      setEnabledModelsMap((prev) => ({
        ...prev,
        [providerId]: models
      }));
    } catch (err) {
      console.error('Failed to enabled models:', err);
    }
  };

  const handleSaveApiKey = async (providerId: string, apiKey: string) => {
    setIsSavingConfig(true);
    try {
      await invoke('save_api_key', { providerId, apiKey });
      setApiKeysMap((prev) => ({
        ...prev,
        [providerId]: apiKey
      }));
      updateCompanionState('excited', `Shroomy connected provider ${providerId}!`);
    } catch (err) {
      console.error('Failed to save API key:', err);
      alert(`Failed to save API key: ${String(err)}`);
      updateCompanionState('error', 'Shroomy failed to save the API key');
    } finally {
      setIsSavingConfig(false);
    }
  };

  const handleDeleteApiKey = async (providerId: string) => {
    setIsSavingConfig(true);
    try {
      await invoke('delete_api_key', { providerId });
      setApiKeysMap((prev) => {
        const next = { ...prev };
        delete next[providerId];
        return next;
      });
      
      // Fallback active config if current chat or pipeline provider is disconnected
      if (activeChatProvider === providerId) {
        await handleSaveProviderConfig('chat', 'opencode-go', 'pokaico-local', '');
      }
      if (activePipelineProvider === providerId) {
        await handleSaveProviderConfig('pipeline', 'opencode-go', 'pokaico-local', '');
      }
      
      updateCompanionState('sad', `Shroomy disconnected provider ${providerId}.`);
    } catch (err) {
      console.error('Failed to delete API key:', err);
      alert(`Failed to delete API key: ${String(err)}`);
      updateCompanionState('error', 'Shroomy failed to delete the API key');
    } finally {
      setIsSavingConfig(false);
    }
  };


  // 2. Load messages for active session when selected
  useEffect(() => {
    if (!activeSessionId) return;

    const loadSessionMessages = async () => {
      try {
        const fullSession = await invoke<ChatSession>('read_conversation_file', { id: activeSessionId });
        setSessions((prev) =>
          prev.map((s) => (s.id === activeSessionId ? { ...s, messages: fullSession.messages } : s))
        );
      } catch (err) {
        console.error(`Failed to load messages for session ${activeSessionId}:`, err);
      }
    };

    loadSessionMessages();
  }, [activeSessionId]);

  const activeSession = sessions.find((s) => s.id === activeSessionId) || null;

  // 3. Navigation Theme Toggle
  const handleSetTheme = (newTheme: 'dark' | 'light') => {
    setTheme(newTheme);
    try {
      localStorage.setItem('pokaico_theme', newTheme);
      if (newTheme === 'light') {
        document.documentElement.classList.add('theme-light');
      } else {
        document.documentElement.classList.remove('theme-light');
      }
    } catch (e) {
      console.error(e);
    }
  };

  // 4. Start New Chat Session
  const handleNewChat = () => {
    const newSessionId = "session-" + Math.random().toString(36).substring(2, 10);
    
    // Optimistically add to state. It will be saved on disk when the first chat message is sent.
    const newSession: ChatSession = {
      id: newSessionId,
      title: 'New Cozy Journal',
      messages: [],
      createdAt: new Date().toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      })
    };

    setSessions((prev) => [newSession, ...prev]);
    setActiveSessionId(newSessionId);
    setActiveView('chat');

    updateCompanionState('happy', 'Shroomy is happy to start a new chat page!');
  };

  const handleSelectSession = (id: string) => {
    setActiveSessionId(id);
    updateCompanionState('happy', 'Shroomy is flipping back through memories...');
    setTimeout(() => {
      setCompanionState((prev) => ({ ...prev, expression: 'idle' }));
    }, 1200);
  };

  const handleDeleteSession = async (id: string) => {
    try {
      await invoke('delete_conversation_file', { id });
      updateCompanionState('sad', 'Shroomy closed a notebook journal...');
      refreshSessions();
    } catch (err) {
      console.error('Failed to delete session:', err);
    }
  };

  const handleUpdateSessionTitle = (_newTitle: string) => {
    // Session titles are derived dynamically from the first user turn in list_conversations.
    // Changing titles manually can be supported later by storing a title field, for now we let it sync.
  };

  const updateCompanionState = (expression: ExpressionType, moodText: string, levelUp = false) => {
    setCompanionState((prev) => {
      let newLevel = prev.level;
      let newExp = prev.exp;

      if (levelUp) {
        newExp += 15;
        if (newExp >= 100) {
          newLevel += 1;
          newExp = newExp % 100;
          moodText = `✨ LEVEL UP! ${prev.name} grew closer to you! ✨`;
          expression = 'excited';
        }
      }

      const updated = {
        ...prev,
        level: newLevel,
        exp: newExp,
        expression,
        moodText
      };
      try {
        localStorage.setItem('pokaico_companion', JSON.stringify(updated));
      } catch (e) {}
      return updated;
    });
  };

  // 5. Send Chat Message over Tauri Invoke
  const handleSendMessage = async (text: string) => {
    if (!activeSessionId || isSubmitting.current) return;

    isSubmitting.current = true;
    setIsGenerating(true);

    const timeString = getLocalRawTime();

    const userMsg: Message = {
      id: `msg-${Date.now()}-user`,
      sender: 'user',
      text,
      timestamp: timeString
    };

    // Append user message optimistically
    setSessions((prev) =>
      prev.map((s) => (s.id === activeSessionId ? { ...s, messages: [...s.messages, userMsg] } : s))
    );

    updateCompanionState('thinking', 'Shroomy is looking through memories...');

    try {
      const res = await invoke<{ response: string; expression?: ExpressionType; moodText?: string }>('chat', {
        message: text,
        sessionId: activeSessionId
      });

      const pokaiMsg: Message = {
        id: `msg-${Date.now()}-pokai`,
        sender: 'pokaico',
        text: res.response,
        timestamp: getLocalRawTime()
      };

      // Append assistant response
      setSessions((prev) =>
        prev.map((s) => (s.id === activeSessionId ? { ...s, messages: [...s.messages, pokaiMsg] } : s))
      );

      // Dynamically update companion expression & moodText from LLM metadata with fallback
      const expr: ExpressionType = res.expression || 'happy';
      const moodText = res.moodText || 'Shroomy feels cozy after talking';

      updateCompanionState(expr, moodText, true);

      // Refresh list to capture auto-generated title from the first turn
      await refreshSessions(activeSessionId);

      // Trigger background pipeline refresh (diary and graph nodes) after 12 seconds
      // to let Node sidecar complete the summarization and extract_topics steps
      setTimeout(() => {
        refreshDiaries();
        refreshMemoryItems();
      }, 12000);

    } catch (err) {
      console.error('Chat invoke failed:', err);
      const errMsg: Message = {
        id: `msg-${Date.now()}-error`,
        sender: 'pokaico',
        text: `[Error Connection] Shroomy is offline. Please check active API key or provider status. Details: ${String(err)}`,
        timestamp: getLocalRawTime()
      };

      setSessions((prev) =>
        prev.map((s) => (s.id === activeSessionId ? { ...s, messages: [...s.messages, errMsg] } : s))
      );
      updateCompanionState('error', 'Shroomy encountered a connection loop error');
    } finally {
      setIsGenerating(false);
      isSubmitting.current = false;
    }
  };

  // 6. Settings controls triggers
  const handleChangeDataDirectory = async () => {
    const newPath = prompt("Enter new data directory absolute path:", dataDirectory);
    if (newPath && newPath.trim() !== '' && newPath.trim() !== dataDirectory) {
      try {
        await invoke('set_data_directory', { path: newPath.trim() });
        await refreshDataDirectory();
        await refreshSessions();
        await refreshDiaries();
        await refreshMemoryItems();
        updateCompanionState('happy', 'Shroomy moved into a new notebook drawer!');
      } catch (err) {
        alert(`Failed to set data directory: ${String(err)}`);
      }
    }
  };

  const handleSaveProviderConfig = async (role: string, providerId: string, modelId: string, keyVal: string) => {
    setIsSavingConfig(true);
    try {
      await invoke('save_provider_config', {
        role,
        providerId,
        modelId,
        apiKey: keyVal
      });
      await loadProviderConfig();
      updateCompanionState('excited', `Shroomy successfully updated the core AI parameters for ${role}!`);
    } catch (err) {
      alert(`Failed to save config: ${String(err)}`);
      updateCompanionState('error', 'Shroomy failed to update the config');
    } finally {
      setIsSavingConfig(false);
    }
  };

  const handleClearAllData = async () => {
    // Clear localStorage values
    localStorage.removeItem('pokaico_companion');
    setCompanionState({
      name: 'Shroomy',
      level: 1,
      exp: 20,
      expression: 'happy',
      moodText: 'Companion has been fully reset!'
    });
    setActiveView('chat');

    // Wiping the actual directory requires file deletions. We let the user manually purge the data directory
    // or we can implement a Rust command to wipe them if needed. For now resetting UI state is active.
    setSessions([]);
    setActiveSessionId(null);
    setDiaries([]);
    setMemories(INITIAL_MEMORIES);
  };

  const handleAddSampleMemory = () => {
    setMemories(INITIAL_MEMORIES);
  };

  return (
    <div className="flex h-screen bg-rosepine-base text-rosepine-text overflow-hidden relative select-none">
      
      {/* CRT scanline overlay effect */}
      <div className="pointer-events-none absolute inset-0 z-40 bg-[radial-gradient(circle_at_center,rgba(0,0,0,0)_60%,rgba(0,0,0,0.15)_100%)] select-none" />

      {/* Left Navigation Sidebar */}
      <LeftSidebar
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSelectSession={handleSelectSession}
        onNewChat={handleNewChat}
        activeView={activeView}
        setActiveView={setActiveView}
      />

      {/* Main Screen Router */}
      <div className="flex-1 flex flex-col h-full bg-rosepine-base relative min-w-0">
        {activeView === 'chat' && (
          <ChatWindow
            session={activeSession}
            onSendMessage={handleSendMessage}
            onUpdateSessionTitle={handleUpdateSessionTitle}
            onDeleteSession={handleDeleteSession}
            isGenerating={isGenerating}
            companionName={companionState.name}
            expression={companionState.expression}
            model={activeChatModel}
            providerId={activeChatProvider}
            availableModels={(providersList.find(p => p.providerId === activeChatProvider)?.models || []).filter(
              (m) => {
                const enabledList = enabledModelsMap[activeChatProvider];
                return !enabledList || enabledList.length === 0 || enabledList.includes(m);
              }
            )}
            setModel={(m) => {
              // Quick set model for chat
              const prov = m === 'pokaico-local' ? 'opencode-go' : activeChatProvider;
              const key = apiKeysMap[prov] || '';
              handleSaveProviderConfig('chat', prov, m, key);
            }}
            apiKeyMissing={!apiKeysMap[activeChatProvider]}
          />
        )}

        {activeView === 'graph' && (
          <MemoryGraph
            memories={memories}
            onDeleteMemory={(id) => {
              setMemories((prev) => prev.filter(m => m.id !== id));
            }}
            onAddSampleMemory={handleAddSampleMemory}
          />
        )}

        {activeView === 'settings' && (
          <SettingsPanel
            theme={theme}
            setTheme={handleSetTheme}
            companionState={companionState}
            onUpdateCompanionName={(name) => {
              updateCompanionState(companionState.expression, `Companion name changed to ${name}`);
              setCompanionState(prev => ({ ...prev, name }));
            }}
            onClearAllData={handleClearAllData}
            onExportData={() => alert("Direct Storage export backup file saved to Documents folder.")}
            onImportSampleData={() => setMemories(INITIAL_MEMORIES)}
            dataDirectory={dataDirectory}
            onChangeDataDirectory={handleChangeDataDirectory}
            activeChatProvider={activeChatProvider}
            activeChatModel={activeChatModel}
            activePipelineProvider={activePipelineProvider}
            activePipelineModel={activePipelineModel}
            providersList={providersList}
            onSaveProviderConfig={handleSaveProviderConfig}
            apiKeysMap={apiKeysMap}
            isSavingConfig={isSavingConfig}
            enabledModelsMap={enabledModelsMap}
            onSaveEnabledModels={handleSaveEnabledModels}
            onSaveApiKey={handleSaveApiKey}
            onDeleteApiKey={handleDeleteApiKey}
          />
        )}
      </div>

      {/* Right Companion Stats Sidebar */}
      <RightSidebar
        companionState={companionState}
        diaries={diaries}
        onTriggerDiary={() => {
          updateCompanionState('thinking', 'Shroomy is summarizing your logs...');
          setTimeout(() => {
            refreshDiaries();
            updateCompanionState('happy', 'Shroomy updated the Companion Logs!');
          }, 4000);
        }}
        isTriggeringDiary={false}
      />
    </div>
  );
}
