import React, { useState } from 'react';
import { Settings, Shield, HardDrive, Volume2, VolumeX, Moon, Sun, Download, Trash2, RefreshCw, Smile, Cloud, Sparkles, Cpu, Search, Palette } from 'lucide-react';
import { CompanionState, CustomizationOptions } from '../types';
import { shroomyTemplate } from './sprites/shroomy';
import { ProceduralSpriteCanvas } from './ProceduralSpriteCanvas';

interface SettingsPanelProps {
  theme: 'dark' | 'light';
  setTheme: (theme: 'dark' | 'light') => void;
  companionState: CompanionState;
  onUpdateCompanionName: (name: string) => void;
  onClearAllData: () => void;
  onExportData: () => void;
  onImportSampleData: () => void;
  dataDirectory: string;
  onChangeDataDirectory: () => void;
  activeChatProvider: string;
  activeChatModel: string;
  activePipelineProvider: string;
  activePipelineModel: string;
  providersList: { providerId: string; providerName: string; models: string[] }[];
  onSaveProviderConfig: (role: string, providerId: string, modelId: string, apiKey: string) => Promise<void>;
  apiKeysMap: Record<string, string>;
  isSavingConfig: boolean;
  enabledModelsMap: Record<string, string[]>;
  onSaveEnabledModels: (providerId: string, models: string[]) => Promise<void>;
  onSaveApiKey: (providerId: string, apiKey: string) => Promise<void>;
  onDeleteApiKey: (providerId: string) => Promise<void>;
}

export const SettingsPanel: React.FC<SettingsPanelProps> = ({
  theme,
  setTheme,
  companionState,
  onUpdateCompanionName,
  onClearAllData,
  onExportData,
  onImportSampleData,
  dataDirectory,
  onChangeDataDirectory,
  activeChatProvider,
  activeChatModel,
  activePipelineProvider,
  activePipelineModel,
  providersList,
  onSaveProviderConfig,
  apiKeysMap,
  isSavingConfig,
  enabledModelsMap,
  onSaveEnabledModels,
  onSaveApiKey,
  onDeleteApiKey
}) => {
  const [activeSubTab, setActiveSubTab] = useState<'general' | 'companion' | 'providers' | 'models' | 'cores'>('general');
  const [nameInput, setNameInput] = useState(companionState.name);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const [spriteOptions, setSpriteOptions] = useState<CustomizationOptions>(() => {
    try {
      const saved = localStorage.getItem('pokaico_sprite_options');
      return saved ? JSON.parse(saved) : shroomyTemplate.defaultOptions;
    } catch {
      return shroomyTemplate.defaultOptions;
    }
  });

  const handleUpdateSpriteOption = (key: string, value: any) => {
    const updated = { ...spriteOptions, [key]: value };
    setSpriteOptions(updated);
    try {
      localStorage.setItem('pokaico_sprite_options', JSON.stringify(updated));
      window.dispatchEvent(new Event('pokaico_sprite_options_updated'));
    } catch (e) {}
  };

  const handleResetSpriteOptions = () => {
    setSpriteOptions(shroomyTemplate.defaultOptions);
    try {
      localStorage.setItem('pokaico_sprite_options', JSON.stringify(shroomyTemplate.defaultOptions));
      window.dispatchEvent(new Event('pokaico_sprite_options_updated'));
    } catch (e) {}
  };
  const [isPlayingLofi, setIsPlayingLofi] = useState(false);
  const [lofiVolume, setLofiVolume] = useState(50);
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
  const [oscillator, setOscillator] = useState<OscillatorNode | null>(null);
  const [gainNode, setGainNode] = useState<GainNode | null>(null);

  const [connectingProviderId, setConnectingProviderId] = useState<string | null>(null);
  const [newApiKeyInput, setNewApiKeyInput] = useState('');

  const [modelSearch, setModelSearch] = useState('');

  const [selectedChatProvider, setSelectedChatProvider] = useState(activeChatProvider || 'google');
  const [selectedChatModel, setSelectedChatModel] = useState(activeChatModel || 'gemini-2.0-flash-lite');
  const [selectedPipelineProvider, setSelectedPipelineProvider] = useState(activePipelineProvider || 'google');
  const [selectedPipelineModel, setSelectedPipelineModel] = useState(activePipelineModel || 'gemini-2.0-flash-lite');

  React.useEffect(() => {
    setSelectedChatProvider(activeChatProvider || 'google');
    setSelectedChatModel(activeChatModel || 'gemini-2.0-flash-lite');
  }, [activeChatProvider, activeChatModel]);

  React.useEffect(() => {
    setSelectedPipelineProvider(activePipelineProvider || 'google');
    setSelectedPipelineModel(activePipelineModel || 'gemini-2.0-flash-lite');
  }, [activePipelineProvider, activePipelineModel]);

  const handleChatProviderChange = (p: string) => {
    setSelectedChatProvider(p);
    const pObj = providersList.find(pr => pr.providerId === p);
    if (pObj) {
      const enabledList = enabledModelsMap[p] || pObj.models;
      setSelectedChatModel(enabledList[0] || pObj.models[0] || '');
    }
  };

  const handlePipelineProviderChange = (p: string) => {
    setSelectedPipelineProvider(p);
    const pObj = providersList.find(pr => pr.providerId === p);
    if (pObj) {
      const enabledList = enabledModelsMap[p] || pObj.models;
      setSelectedPipelineModel(enabledList[0] || pObj.models[0] || '');
    }
  };

  const startLofiSynth = () => {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(130.81, ctx.currentTime);

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(400, ctx.currentTime);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);

      gain.gain.setValueAtTime((lofiVolume / 100) * 0.1, ctx.currentTime);
      osc.start();

      setAudioContext(ctx);
      setOscillator(osc);
      setGainNode(gain);
      setIsPlayingLofi(true);

      let step = 0;
      const notes = [130.81, 146.83, 164.81, 196.00, 220.00];
      const interval = setInterval(() => {
        if (osc && ctx.state !== 'closed') {
          const nextFreq = notes[step % notes.length];
          osc.frequency.setValueAtTime(nextFreq, ctx.currentTime);
          step++;
        } else {
          clearInterval(interval);
        }
      }, 3000);
    } catch (e) {
      console.error("Audio synth error:", e);
    }
  };

  const stopLofiSynth = () => {
    if (oscillator) {
      try { oscillator.stop(); oscillator.disconnect(); } catch (e) {}
      setOscillator(null);
    }
    if (audioContext) {
      try { audioContext.close(); } catch (e) {}
      setAudioContext(null);
    }
    setIsPlayingLofi(false);
  };

  const handleToggleLofi = () => { isPlayingLofi ? stopLofiSynth() : startLofiSynth(); };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const vol = parseInt(e.target.value);
    setLofiVolume(vol);
    if (gainNode && audioContext) gainNode.gain.setValueAtTime((vol / 100) * 0.1, audioContext.currentTime);
  };

  const handleSaveName = () => {
    if (nameInput.trim()) {
      onUpdateCompanionName(nameInput.trim());
    }
  };

  const handleToggleModel = async (providerId: string, modelId: string) => {
    const providerObj = providersList.find(p => p.providerId === providerId);
    const allModels = providerObj ? providerObj.models : [];
    const currentEnabled = enabledModelsMap[providerId] || allModels;
    
    let nextEnabled: string[];
    if (currentEnabled.includes(modelId)) {
      if (currentEnabled.length <= 1) {
        alert("At least one model must remain enabled!");
        return;
      }
      nextEnabled = currentEnabled.filter(m => m !== modelId);
    } else {
      nextEnabled = [...currentEnabled, modelId];
    }
    await onSaveEnabledModels(providerId, nextEnabled);
  };

  const getModelDisplayName = (m: string) => {
    const cleanName = m.replace(/^[a-zA-Z0-9-]+\//, '');
    return cleanName.replace(/-/g, ' ').toUpperCase();
  };

  const connectedProviders = providersList.filter(p => !!apiKeysMap[p.providerId]);
  const availableProviders = providersList.filter(p => !apiKeysMap[p.providerId]);

  return (
    <div className="w-full h-full flex flex-col font-pixel text-rosepine-text p-6 overflow-hidden">
      <div className="flex items-center justify-between border-b-4 border-rosepine-overlay pb-3 mb-4 flex-shrink-0">
        <div className="flex items-center gap-2">
          <Settings className="w-6 h-6 text-rosepine-rose animate-spin" style={{ animationDuration: '8s' }} />
          <h2 className="text-2xl tracking-wider">POKAICO COZY CONTROLS</h2>
        </div>
      </div>

      <div className="flex-1 flex gap-6 overflow-hidden">
        <div className="w-48 flex-shrink-0 border-r-2 border-rosepine-overlay/40 pr-4 flex flex-col gap-2">
          <button
            onClick={() => setActiveSubTab('general')}
            className={`w-full flex items-center gap-2 px-3 py-2 border-2 rounded text-xs font-press text-left cursor-pointer transition-colors ${
              activeSubTab === 'general'
                ? 'border-rosepine-rose bg-rosepine-overlay text-rosepine-rose'
                : 'border-transparent bg-transparent hover:bg-rosepine-overlay/40 text-rosepine-muted'
            }`}
          >
            <Smile className="w-4 h-4" />
            GENERAL
          </button>

          <button
            onClick={() => setActiveSubTab('companion')}
            className={`w-full flex items-center gap-2 px-3 py-2 border-2 rounded text-xs font-press text-left cursor-pointer transition-colors ${
              activeSubTab === 'companion'
                ? 'border-rosepine-iris bg-rosepine-overlay text-rosepine-iris'
                : 'border-transparent bg-transparent hover:bg-rosepine-overlay/40 text-rosepine-muted'
            }`}
          >
            <Palette className="w-4 h-4" />
            COMPANION
          </button>
          
          <button
            onClick={() => setActiveSubTab('providers')}
            className={`w-full flex items-center gap-2 px-3 py-2 border-2 rounded text-xs font-press text-left cursor-pointer transition-colors ${
              activeSubTab === 'providers'
                ? 'border-rosepine-gold bg-rosepine-overlay text-rosepine-gold'
                : 'border-transparent bg-transparent hover:bg-rosepine-overlay/40 text-rosepine-muted'
            }`}
          >
            <Cloud className="w-4 h-4" />
            PROVIDERS
          </button>

          <button
            onClick={() => setActiveSubTab('models')}
            className={`w-full flex items-center gap-2 px-3 py-2 border-2 rounded text-xs font-press text-left cursor-pointer transition-colors ${
              activeSubTab === 'models'
                ? 'border-rosepine-foam bg-rosepine-overlay text-rosepine-foam'
                : 'border-transparent bg-transparent hover:bg-rosepine-overlay/40 text-rosepine-muted'
            }`}
          >
            <Sparkles className="w-4 h-4" />
            MODELS
          </button>

          <button
            onClick={() => setActiveSubTab('cores')}
            className={`w-full flex items-center gap-2 px-3 py-2 border-2 rounded text-xs font-press text-left cursor-pointer transition-colors ${
              activeSubTab === 'cores'
                ? 'border-rosepine-rose bg-rosepine-overlay text-rosepine-rose'
                : 'border-transparent bg-transparent hover:bg-rosepine-overlay/40 text-rosepine-muted'
            }`}
          >
            <Cpu className="w-4 h-4" />
            CORES
          </button>
        </div>

        <div className="flex-1 overflow-y-auto pr-1">
          {activeSubTab === 'general' && (
            <div className="space-y-6">
              <div className="border-2 border-rosepine-overlay bg-rosepine-surface p-4 rounded">
                <div className="flex items-center gap-2 text-rosepine-gold mb-3">
                  <Smile className="w-4 h-4" />
                  <span className="text-sm font-press uppercase">Companion Profile</span>
                </div>
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-mono text-rosepine-muted mb-1.5 uppercase">Assign Name to Companion:</label>
                    <div className="flex gap-2">
                      <input type="text" value={nameInput} onChange={(e) => setNameInput(e.target.value)} maxLength={12} className="flex-1 bg-rosepine-base border-2 border-rosepine-overlay px-3 py-1.5 font-mono text-xs rounded outline-none focus:border-rosepine-rose" placeholder="Companion name" />
                      <button onClick={handleSaveName} className="px-4 py-1.5 border-2 border-rosepine-overlay bg-rosepine-overlay text-rosepine-rose hover:bg-rosepine-muted/30 text-xs tracking-wider font-press transition-colors rounded cursor-pointer">SAVE</button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-mono text-rosepine-muted mb-1.5 uppercase">Visual Aesthetic Tone:</label>
                    <div className="flex gap-2">
                      <button onClick={() => setTheme('dark')} className={`flex-1 flex items-center justify-center gap-2 py-2 border-2 rounded text-xs font-press cursor-pointer ${theme === 'dark' ? 'border-rosepine-rose bg-rosepine-overlay text-rosepine-rose' : 'border-rosepine-overlay bg-rosepine-base hover:bg-rosepine-overlay/40 text-rosepine-muted'}`}>
                        <Moon className="w-3.5 h-3.5" /> ROSEPINE MAIN
                      </button>
                      <button onClick={() => setTheme('light')} className={`flex-1 flex items-center justify-center gap-2 py-2 border-2 rounded text-xs font-press cursor-pointer ${theme === 'light' ? 'border-rosepine-rose bg-rosepine-overlay text-rosepine-rose' : 'border-rosepine-overlay bg-rosepine-base hover:bg-rosepine-overlay/40 text-rosepine-muted'}`}>
                        <Sun className="w-3.5 h-3.5" /> ROSEPINE DAWN
                      </button>
                    </div>
                  </div>

                  <div className="border-t-2 border-rosepine-overlay/40 pt-4">
                    <label className="block text-xs font-mono text-rosepine-muted mb-2 uppercase">Ambient Cozy Synth:</label>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={handleToggleLofi}
                        className={`px-4 py-2 border-2 rounded text-xs font-press cursor-pointer flex items-center gap-2 transition-colors ${
                          isPlayingLofi 
                            ? 'border-rosepine-rose bg-rosepine-overlay text-rosepine-rose animate-pulse'
                            : 'border-rosepine-overlay bg-rosepine-base hover:bg-rosepine-overlay/40 text-rosepine-muted'
                        }`}
                      >
                        {isPlayingLofi ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
                        {isPlayingLofi ? 'STOP SYNTH' : 'PLAY AMBIENT'}
                      </button>
                      <div className="flex-1 flex items-center gap-2">
                        <span className="text-[10px] font-mono text-rosepine-subtle">VOL:</span>
                        <input
                          type="range"
                          min="0"
                          max="100"
                          value={lofiVolume}
                          onChange={handleVolumeChange}
                          className="flex-1 h-1 bg-rosepine-overlay rounded-lg appearance-none cursor-pointer accent-rosepine-rose"
                        />
                        <span className="text-xs font-mono text-rosepine-rose w-8 text-right">{lofiVolume}%</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="border-2 border-rosepine-overlay bg-rosepine-surface p-4 rounded">
                <div className="flex items-center gap-2 text-rosepine-rose mb-3">
                  <HardDrive className="w-4 h-4" />
                  <span className="text-sm font-press uppercase">DATA DIRECTORY PATH</span>
                </div>
                <p className="text-xs font-mono text-rosepine-subtle mb-3 leading-relaxed">All conversations, index pages, and companion logs are kept local in this path.</p>
                <div className="flex gap-2">
                  <input type="text" readOnly value={dataDirectory || '(No directory chosen)'} className="flex-1 bg-rosepine-base border-2 border-rosepine-overlay px-3 py-1.5 font-mono text-xs rounded text-rosepine-muted outline-none" />
                  <button onClick={onChangeDataDirectory} className="px-4 py-1.5 border-2 border-rosepine-overlay bg-rosepine-overlay text-rosepine-foam hover:bg-rosepine-muted/30 text-xs tracking-wider font-press transition-colors rounded cursor-pointer">CHANGE</button>
                </div>
              </div>

              <div className="border-2 border-rosepine-overlay bg-rosepine-surface p-4 rounded">
                <div className="flex items-center gap-2 text-rosepine-foam mb-3">
                  <Shield className="w-4 h-4" />
                  <span className="text-sm font-press uppercase">Direct Storage Privacy</span>
                </div>
                <p className="text-xs font-mono text-rosepine-subtle mb-4 leading-relaxed">
                  To ensure absolute privacy, Pokaico stores all memory logs, journals, and dialog history directly on your localized Direct Storage client. No analytics, no surveillance.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    onClick={onExportData}
                    className="flex items-center justify-center gap-2 p-2 border-2 border-rosepine-overlay bg-rosepine-base hover:bg-rosepine-overlay rounded text-xs font-press text-rosepine-foam transition-colors cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" /> EXPORT BACKUP
                  </button>
                  <button
                    onClick={onImportSampleData}
                    className="flex items-center justify-center gap-2 p-2 border-2 border-rosepine-overlay bg-rosepine-base hover:bg-rosepine-overlay rounded text-xs font-press text-rosepine-gold transition-colors cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5" /> RESET TEMPLATE
                  </button>
                </div>

                <div className="mt-4 border-t-2 border-rosepine-overlay/40 pt-4">
                  {showClearConfirm ? (
                    <div className="bg-rosepine-base p-3 border-2 border-rosepine-love rounded animate-shake">
                      <span className="text-xs font-mono text-rosepine-love block mb-2 font-semibold">
                        WARNING: This will wipe all chats, memories, and diaries permanently!
                      </span>
                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            onClearAllData();
                            setShowClearConfirm(false);
                          }}
                          className="flex-1 py-1 px-2 bg-rosepine-love text-rosepine-base rounded text-xs font-press uppercase cursor-pointer"
                        >
                          YES, ERASE ALL
                        </button>
                        <button
                          onClick={() => setShowClearConfirm(false)}
                          className="px-3 py-1 bg-rosepine-overlay text-rosepine-text rounded text-xs font-mono cursor-pointer"
                        >
                          CANCEL
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => setShowClearConfirm(true)}
                      className="w-full flex items-center justify-center gap-2 py-2.5 bg-rosepine-love/10 hover:bg-rosepine-love/20 text-rosepine-love border border-rosepine-love/30 rounded text-xs font-press transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" /> PURGE DIRECT STORAGE
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {activeSubTab === 'companion' && (
            <div className="space-y-6">
              <div className="bg-rosepine-base/40 border-2 border-rosepine-overlay rounded p-4 flex gap-6 items-center">
                <div className="w-40 h-40 bg-rosepine-base border-4 border-rosepine-overlay rounded flex flex-col items-center justify-center p-2 relative overflow-hidden flex-shrink-0">
                  <div className="absolute bottom-0 left-0 right-0 h-4 bg-rosepine-pine/20 border-t border-rosepine-pine/40" />
                  <ProceduralSpriteCanvas
                    template={shroomyTemplate}
                    expression="happy"
                    options={spriteOptions}
                    size={140}
                    className="z-10"
                  />
                </div>
                <div className="flex-1 space-y-2">
                  <h3 className="text-lg font-press text-rosepine-rose flex items-center gap-2">
                    <Palette className="w-5 h-5 text-rosepine-rose" />
                    COMPANION CUSTOMIZATION
                  </h3>
                  <p className="text-xs text-rosepine-muted font-mono leading-relaxed">
                    Personalize your cozy companion's procedural 64x64 pixel aesthetics. All color choices and style choices update live and persist automatically across sessions.
                  </p>
                  <button
                    onClick={handleResetSpriteOptions}
                    className="px-3 py-1.5 border border-rosepine-overlay bg-rosepine-base hover:bg-rosepine-overlay text-rosepine-muted hover:text-rosepine-rose text-[10px] font-press rounded transition-colors cursor-pointer"
                  >
                    RESET TO DEFAULTS
                  </button>
                </div>
              </div>

              {Object.entries(
                shroomyTemplate.customizationSchema.reduce((acc, field) => {
                  const cat = field.category || 'General';
                  if (!acc[cat]) acc[cat] = [];
                  acc[cat].push(field);
                  return acc;
                }, {} as Record<string, typeof shroomyTemplate.customizationSchema>)
              ).map(([categoryName, fields]) => (
                <div key={categoryName} className="bg-rosepine-base/30 border-2 border-rosepine-overlay rounded p-4 space-y-4">
                  <h4 className="text-xs font-press uppercase tracking-wider text-rosepine-gold border-b border-rosepine-overlay pb-2">
                    {categoryName}
                  </h4>
                  <div className="grid grid-cols-2 gap-4">
                    {fields.map((field) => {
                      const currentValue = spriteOptions[field.id] ?? field.defaultValue;
                      return (
                        <div key={field.id} className="flex flex-col gap-1 bg-rosepine-base/50 p-2.5 rounded border border-rosepine-overlay/40">
                          <label className="text-[10px] font-press text-rosepine-text flex items-center justify-between">
                            <span>{field.label}</span>
                            {field.type === 'color' && (
                              <span className="font-mono text-[9px] text-rosepine-muted uppercase">{currentValue}</span>
                            )}
                          </label>

                          {field.type === 'color' && (
                            <div className="flex items-center gap-2 mt-1">
                              <input
                                type="color"
                                value={currentValue}
                                onChange={(e) => handleUpdateSpriteOption(field.id, e.target.value)}
                                className="w-8 h-8 rounded border-2 border-rosepine-overlay cursor-pointer bg-transparent"
                              />
                              <input
                                type="text"
                                value={currentValue}
                                onChange={(e) => handleUpdateSpriteOption(field.id, e.target.value)}
                                className="flex-1 bg-rosepine-base border border-rosepine-overlay rounded px-2 py-1 text-xs font-mono"
                              />
                            </div>
                          )}

                          {field.type === 'select' && (
                            <select
                              value={currentValue}
                              onChange={(e) => handleUpdateSpriteOption(field.id, e.target.value)}
                              className="bg-rosepine-base border border-rosepine-overlay rounded px-2 py-1.5 text-xs font-mono mt-1 text-rosepine-text cursor-pointer"
                            >
                              {field.options?.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                          )}

                          {field.type === 'number' && (
                            <div className="flex items-center gap-2 mt-1">
                              <input
                                type="range"
                                min={field.min ?? 0.1}
                                max={field.max ?? 3.0}
                                step={field.step ?? 0.1}
                                value={currentValue}
                                onChange={(e) => handleUpdateSpriteOption(field.id, parseFloat(e.target.value))}
                                className="flex-1 accent-rosepine-rose cursor-pointer"
                              />
                              <span className="text-xs font-mono w-8 text-right">{currentValue}x</span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {activeSubTab === 'providers' && (
            <div className="space-y-6">
              <div className="border-2 border-rosepine-overlay bg-rosepine-surface p-4 rounded">
                <div className="flex items-center gap-2 text-rosepine-gold mb-1">
                  <Cloud className="w-4 h-4" />
                  <span className="text-sm font-press uppercase">Connected Providers</span>
                </div>
                <p className="text-xs font-mono text-rosepine-subtle mb-4 leading-relaxed">
                  These providers have credentials saved and are ready to be used.
                </p>

                <div className="space-y-2">
                  {connectedProviders.map((p) => (
                    <div key={p.providerId} className="flex items-center justify-between bg-rosepine-base border-2 border-rosepine-overlay p-3 rounded">
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-press text-rosepine-text">{p.providerName}</span>
                        <span className="bg-rosepine-overlay text-rosepine-rose text-[9px] font-mono px-2 py-0.5 rounded uppercase tracking-wider">CONNECTED</span>
                      </div>
                      <button
                        onClick={() => {
                          if (confirm(`Disconnect ${p.providerName}? This will clear its saved API key.`)) {
                            onDeleteApiKey(p.providerId);
                          }
                        }}
                        disabled={isSavingConfig}
                        className="px-3 py-1 bg-rosepine-love/10 hover:bg-rosepine-love/20 text-rosepine-love border border-rosepine-love/30 text-[10px] font-press rounded transition-colors cursor-pointer disabled:opacity-50"
                      >
                        DISCONNECT
                      </button>
                    </div>
                  ))}

                  {connectedProviders.length === 0 && (
                    <div className="text-center py-6 border-2 border-dashed border-rosepine-overlay bg-rosepine-base/50 text-xs font-mono text-rosepine-muted rounded">
                      No AI providers connected yet. Connect one below!
                    </div>
                  )}
                </div>
              </div>

              <div className="border-2 border-rosepine-overlay bg-rosepine-surface p-4 rounded">
                <div className="flex items-center gap-2 text-rosepine-foam mb-1">
                  <Cloud className="w-4 h-4 text-rosepine-rose" />
                  <span className="text-sm font-press uppercase">Available Providers</span>
                </div>
                <p className="text-xs font-mono text-rosepine-subtle mb-4 leading-relaxed">
                  Connect your preferred model provider using an API key.
                </p>

                <div className="space-y-2">
                  {availableProviders.map((p) => {
                    const isConnecting = connectingProviderId === p.providerId;
                    return (
                      <div key={p.providerId} className="bg-rosepine-base border-2 border-rosepine-overlay p-3 rounded space-y-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <span className="text-xs font-press text-rosepine-text block">{p.providerName}</span>
                            <span className="text-[10px] font-mono text-rosepine-muted uppercase">ID: {p.providerId}</span>
                          </div>
                          {!isConnecting && (
                            <button
                              onClick={() => {
                                setConnectingProviderId(p.providerId);
                                setNewApiKeyInput('');
                              }}
                              className="px-3 py-1 bg-rosepine-overlay hover:bg-rosepine-highlight-med text-rosepine-rose border-2 border-rosepine-overlay text-[10px] font-press rounded transition-colors cursor-pointer"
                            >
                              CONNECT
                            </button>
                          )}
                        </div>

                        {isConnecting && (
                          <div className="border-t border-rosepine-overlay/40 pt-3 space-y-3">
                            <div>
                              <label className="block text-[10px] font-mono text-rosepine-muted mb-1.5 uppercase">API Key for {p.providerName}:</label>
                              <input
                                type="password"
                                value={newApiKeyInput}
                                onChange={(e) => setNewApiKeyInput(e.target.value)}
                                placeholder="Enter API key..."
                                className="w-full bg-rosepine-surface border-2 border-rosepine-overlay px-3 py-2 font-mono text-xs rounded text-rosepine-text outline-none focus:border-rosepine-rose"
                              />
                            </div>
                            <div className="flex gap-2 justify-end">
                              <button
                                onClick={() => setConnectingProviderId(null)}
                                className="px-3 py-1.5 border border-rosepine-overlay bg-rosepine-base hover:bg-rosepine-overlay text-[10px] font-press rounded cursor-pointer text-rosepine-muted"
                              >
                                CANCEL
                              </button>
                              <button
                                onClick={async () => {
                                  if (!newApiKeyInput.trim()) {
                                    alert("API Key cannot be empty!");
                                    return;
                                  }
                                  await onSaveApiKey(p.providerId, newApiKeyInput.trim());
                                  setConnectingProviderId(null);
                                }}
                                disabled={isSavingConfig}
                                className="px-3 py-1.5 border-2 border-rosepine-overlay bg-rosepine-overlay hover:bg-rosepine-highlight-med text-[10px] font-press rounded cursor-pointer text-rosepine-rose disabled:opacity-50"
                              >
                                {isSavingConfig ? 'CONNECTING...' : 'SAVE CONNECTION'}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {activeSubTab === 'models' && (
            <div className="space-y-6">
              <div className="border-2 border-rosepine-overlay bg-rosepine-surface p-4 rounded">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2 text-rosepine-foam">
                    <Sparkles className="w-4 h-4" />
                    <span className="text-sm font-press uppercase">Models Toggling</span>
                  </div>
                </div>
                <p className="text-xs font-mono text-rosepine-subtle mb-4 leading-relaxed">
                  Toggle which models appear in the chat selector dropdown. Disconnected providers are hidden.
                </p>

                {connectedProviders.length > 0 && (
                  <div className="relative mb-4">
                    <Search className="absolute left-3 top-2.5 w-4 h-4 text-rosepine-muted" />
                    <input
                      type="text"
                      placeholder="SEARCH MODELS..."
                      value={modelSearch}
                      onChange={(e) => setModelSearch(e.target.value)}
                      className="w-full bg-rosepine-base border-2 border-rosepine-overlay pl-9 pr-3 py-2 font-mono text-xs rounded text-rosepine-text outline-none focus:border-rosepine-rose uppercase"
                    />
                  </div>
                )}

                <div className="space-y-4">
                  {connectedProviders.map((p) => {
                    const matchedModels = p.models.filter(m => 
                      m.toLowerCase().includes(modelSearch.toLowerCase()) ||
                      getModelDisplayName(m).toLowerCase().includes(modelSearch.toLowerCase())
                    );

                    if (matchedModels.length === 0) return null;

                    return (
                      <div key={p.providerId} className="space-y-2 border-b border-rosepine-overlay/30 pb-3 last:border-0 last:pb-0">
                        <span className="text-[10px] font-press text-rosepine-gold uppercase block mb-1.5">{p.providerName}</span>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 bg-rosepine-base border-2 border-rosepine-overlay p-3 rounded max-h-40 overflow-y-auto">
                          {matchedModels.map((m) => {
                            const isEnabled = (enabledModelsMap[p.providerId] || p.models).includes(m);
                            return (
                              <label key={m} className="flex items-center gap-2 text-xs font-mono cursor-pointer select-none text-rosepine-text hover:text-rosepine-rose">
                                <input
                                  type="checkbox"
                                  checked={isEnabled}
                                  onChange={() => handleToggleModel(p.providerId, m)}
                                  className="accent-rosepine-rose cursor-pointer"
                                />
                                <span className="truncate" title={m}>{getModelDisplayName(m)}</span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}

                  {connectedProviders.length === 0 && (
                    <div className="text-center py-8 border-2 border-dashed border-rosepine-overlay bg-rosepine-base/50 text-xs font-mono text-rosepine-muted rounded">
                      Please connect at least one AI provider in the Providers tab to configure models.
                    </div>
                  )}

                  {connectedProviders.length > 0 && connectedProviders.every(p => 
                    p.models.filter(m => 
                      m.toLowerCase().includes(modelSearch.toLowerCase()) ||
                      getModelDisplayName(m).toLowerCase().includes(modelSearch.toLowerCase())
                    ).length === 0
                  ) && (
                    <div className="text-center py-6 text-xs font-mono text-rosepine-muted">
                      No models matched your search query.
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {activeSubTab === 'cores' && (
            <div className="space-y-6">
              <div className="border-2 border-rosepine-overlay bg-rosepine-surface p-4 rounded">
                <div className="flex items-center gap-2 text-rosepine-rose mb-3">
                  <Cpu className="w-4 h-4" />
                  <span className="text-sm font-press uppercase">Chat Companion Core</span>
                </div>
                
                {connectedProviders.length > 0 ? (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-mono text-rosepine-muted mb-1.5 uppercase">Chat Provider:</label>
                      <select 
                        value={selectedChatProvider} 
                        onChange={(e) => handleChatProviderChange(e.target.value)} 
                        className="w-full bg-rosepine-base border-2 border-rosepine-overlay px-3 py-2 font-mono text-xs rounded text-rosepine-text outline-none focus:border-rosepine-rose cursor-pointer"
                      >
                        {connectedProviders.map((p) => (
                          <option key={p.providerId} value={p.providerId}>{p.providerName}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-mono text-rosepine-muted mb-1.5 uppercase">Chat Model:</label>
                      <select 
                        value={selectedChatModel} 
                        onChange={(e) => setSelectedChatModel(e.target.value)} 
                        className="w-full bg-rosepine-base border-2 border-rosepine-overlay px-3 py-2 font-mono text-xs rounded text-rosepine-text outline-none focus:border-rosepine-rose cursor-pointer"
                      >
                        {(enabledModelsMap[selectedChatProvider] || providersList.find(p => p.providerId === selectedChatProvider)?.models || []).map((m) => (
                          <option key={m} value={m}>{getModelDisplayName(m)}</option>
                        ))}
                      </select>
                    </div>

                    <button 
                      onClick={() => onSaveProviderConfig('chat', selectedChatProvider, selectedChatModel, apiKeysMap[selectedChatProvider] || '')} 
                      disabled={isSavingConfig} 
                      className="w-full py-2 border-2 border-rosepine-overlay bg-rosepine-overlay hover:bg-rosepine-highlight-med text-rosepine-rose font-press text-xs tracking-wider transition-colors rounded cursor-pointer disabled:opacity-50"
                    >
                      {isSavingConfig ? 'SAVING CHAT SETTINGS...' : 'SAVE CHAT SETTINGS'}
                    </button>
                  </div>
                ) : (
                  <div className="text-center py-6 text-xs font-mono text-rosepine-muted">
                    Please connect a provider first to configure Chat Core.
                  </div>
                )}
              </div>

              <div className="border-2 border-rosepine-overlay bg-rosepine-surface p-4 rounded">
                <div className="flex items-center gap-2 text-rosepine-foam mb-3">
                  <Shield className="w-4 h-4" />
                  <span className="text-sm font-press uppercase">Memory Pipeline Core</span>
                </div>

                {connectedProviders.length > 0 ? (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-mono text-rosepine-muted mb-1.5 uppercase">Pipeline Provider:</label>
                      <select 
                        value={selectedPipelineProvider} 
                        onChange={(e) => handlePipelineProviderChange(e.target.value)} 
                        className="w-full bg-rosepine-base border-2 border-rosepine-overlay px-3 py-2 font-mono text-xs rounded text-rosepine-text outline-none focus:border-rosepine-rose cursor-pointer"
                      >
                        {connectedProviders.map((p) => (
                          <option key={p.providerId} value={p.providerId}>{p.providerName}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-mono text-rosepine-muted mb-1.5 uppercase">Pipeline Model:</label>
                      <select 
                        value={selectedPipelineModel} 
                        onChange={(e) => setSelectedPipelineModel(e.target.value)} 
                        className="w-full bg-rosepine-base border-2 border-rosepine-overlay px-3 py-2 font-mono text-xs rounded text-rosepine-text outline-none focus:border-rosepine-rose cursor-pointer"
                      >
                        {(enabledModelsMap[selectedPipelineProvider] || providersList.find(p => p.providerId === selectedPipelineProvider)?.models || []).map((m) => (
                          <option key={m} value={m}>{getModelDisplayName(m)}</option>
                        ))}
                      </select>
                    </div>

                    <button 
                      onClick={() => onSaveProviderConfig('pipeline', selectedPipelineProvider, selectedPipelineModel, apiKeysMap[selectedPipelineProvider] || '')} 
                      disabled={isSavingConfig} 
                      className="w-full py-2 border-2 border-rosepine-overlay bg-rosepine-overlay hover:bg-rosepine-highlight-med text-rosepine-foam font-press text-xs tracking-wider transition-colors rounded cursor-pointer disabled:opacity-50"
                    >
                      {isSavingConfig ? 'SAVING PIPELINE SETTINGS...' : 'SAVE PIPELINE SETTINGS'}
                    </button>
                  </div>
                ) : (
                  <div className="text-center py-6 text-xs font-mono text-rosepine-muted">
                    Please connect a provider first to configure Pipeline Core.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
