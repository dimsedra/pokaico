import React, { useState } from 'react';
import { Settings, Shield, HardDrive, Volume2, VolumeX, Moon, Sun, Download, Trash2, RefreshCw, Smile } from 'lucide-react';
import { CompanionState } from '../types';

interface SettingsPanelProps {
  theme: 'dark' | 'light';
  setTheme: (theme: 'dark' | 'light') => void;
  companionState: CompanionState;
  onUpdateCompanionName: (name: string) => void;
  onClearAllData: () => void;
  onExportData: () => void;
  onImportSampleData: () => void;
  // Dynamic settings inputs for Tauri integrations
  dataDirectory: string;
  onChangeDataDirectory: () => void;
  activeProvider: string;
  activeModel: string;
  providersList: { providerId: string; providerName: string; models: string[] }[];
  onSaveProviderConfig: (providerId: string, modelId: string, apiKey: string) => Promise<void>;
  apiKey: string;
  setApiKey: (key: string) => void;
  isSavingConfig: boolean;
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
  activeProvider,
  activeModel,
  providersList,
  onSaveProviderConfig,
  apiKey,
  setApiKey,
  isSavingConfig
}) => {
  const [nameInput, setNameInput] = useState(companionState.name);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [isPlayingLofi, setIsPlayingLofi] = useState(false);
  const [lofiVolume, setLofiVolume] = useState(50);
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
  const [oscillator, setOscillator] = useState<OscillatorNode | null>(null);
  const [gainNode, setGainNode] = useState<GainNode | null>(null);

  // Selected config builder state
  const [selectedProvider, setSelectedProvider] = useState(activeProvider || 'google');
  const [selectedModel, setSelectedModel] = useState(activeModel || 'gemini-2.0-flash-lite');

  React.useEffect(() => {
    setSelectedProvider(activeProvider || 'google');
    setSelectedModel(activeModel || 'gemini-2.0-flash-lite');
  }, [activeProvider, activeModel]);

  // Simple synthesized retro lo-fi chord progression using Web Audio API!
  const startLofiSynth = () => {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'triangle'; // Cozy soft sound
      osc.frequency.setValueAtTime(130.81, ctx.currentTime); // C3 chord root

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
      const notes = [130.81, 146.83, 164.81, 196.00, 220.00]; // Pentatonic cozy scale
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
      try {
        oscillator.stop();
        oscillator.disconnect();
      } catch (e) {}
      setOscillator(null);
    }
    if (audioContext) {
      try {
        audioContext.close();
      } catch (e) {}
      setAudioContext(null);
    }
    setIsPlayingLofi(false);
  };

  const handleToggleLofi = () => {
    if (isPlayingLofi) {
      stopLofiSynth();
    } else {
      startLofiSynth();
    }
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const vol = parseInt(e.target.value);
    setLofiVolume(vol);
    if (gainNode && audioContext) {
      gainNode.gain.setValueAtTime((vol / 100) * 0.1, audioContext.currentTime);
    }
  };

  const handleSaveName = () => {
    if (nameInput.trim()) {
      onUpdateCompanionName(nameInput.trim());
    }
  };

  const selectedProviderData = providersList.find(p => p.providerId === selectedProvider);
  const modelsForSelectedProvider = selectedProviderData ? selectedProviderData.models : [];

  return (
    <div className="w-full h-full flex flex-col font-pixel text-rosepine-text p-6 overflow-hidden">
      <div className="flex items-center justify-between border-b-4 border-rosepine-overlay pb-3 mb-4 flex-shrink-0">
        <div className="flex items-center gap-2">
          <Settings className="w-6 h-6 text-rosepine-rose animate-spin" style={{ animationDuration: '6s' }} />
          <h2 className="text-2xl tracking-wider">POKAICO COZY CONTROLS</h2>
        </div>
      </div>

      <div className="space-y-6 flex-1 overflow-y-auto pr-1">
        
        {/* Core AI Provider Credentials Setup (API & Models) */}
        <div className="border-2 border-rosepine-overlay bg-rosepine-surface p-4 rounded">
          <div className="flex items-center gap-2 text-rosepine-gold mb-3">
            <Settings className="w-4 h-4" />
            <span className="text-sm font-press uppercase">AI CORE CONFIGURATION</span>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-mono text-rosepine-muted mb-1.5 uppercase">
                Active Provider:
              </label>
              <select
                value={selectedProvider}
                onChange={(e) => {
                  const p = e.target.value;
                  setSelectedProvider(p);
                  const pData = providersList.find(pr => pr.providerId === p);
                  if (pData && pData.models.length > 0) {
                    setSelectedModel(pData.models[0]);
                  }
                }}
                className="w-full bg-rosepine-base border-2 border-rosepine-overlay px-3 py-2 font-mono text-xs rounded text-rosepine-text outline-none focus:border-rosepine-rose cursor-pointer"
              >
                {providersList.map((p) => (
                  <option key={p.providerId} value={p.providerId}>
                    {p.providerName} ({p.providerId})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-mono text-rosepine-muted mb-1.5 uppercase">
                Active Model:
              </label>
              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                className="w-full bg-rosepine-base border-2 border-rosepine-overlay px-3 py-2 font-mono text-xs rounded text-rosepine-text outline-none focus:border-rosepine-rose cursor-pointer"
              >
                {modelsForSelectedProvider.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-mono text-rosepine-muted mb-1.5 uppercase">
                Provider API Key:
              </label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={`API Key for ${selectedProvider}...`}
                className="w-full bg-rosepine-base border-2 border-rosepine-overlay px-3 py-2 font-mono text-xs rounded text-rosepine-text outline-none focus:border-rosepine-rose"
              />
            </div>

            <button
              onClick={() => onSaveProviderConfig(selectedProvider, selectedModel, apiKey)}
              disabled={isSavingConfig}
              className="w-full py-2 border-2 border-rosepine-overlay bg-rosepine-overlay hover:bg-rosepine-highlight-med text-rosepine-rose font-press text-xs tracking-wider transition-colors rounded cursor-pointer disabled:opacity-50"
            >
              {isSavingConfig ? 'SAVING CONFIG CORE...' : 'SAVE PROVIDER SETTINGS'}
            </button>
          </div>
        </div>

        {/* Local storage directories */}
        <div className="border-2 border-rosepine-overlay bg-rosepine-surface p-4 rounded">
          <div className="flex items-center gap-2 text-rosepine-foam mb-3">
            <HardDrive className="w-4 h-4" />
            <span className="text-sm font-press uppercase">DATA DIRECTORY PATH</span>
          </div>
          <p className="text-xs font-mono text-rosepine-subtle mb-3 leading-relaxed">
            All conversations, index pages, and companion logs are kept local in this path.
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              readOnly
              value={dataDirectory || '(No directory chosen)'}
              className="flex-1 bg-rosepine-base border-2 border-rosepine-overlay px-3 py-1.5 font-mono text-xs rounded text-rosepine-muted outline-none"
            />
            <button
              onClick={onChangeDataDirectory}
              className="px-4 py-1.5 border-2 border-rosepine-overlay bg-rosepine-overlay text-rosepine-foam hover:bg-rosepine-muted/30 text-xs tracking-wider font-press transition-colors rounded cursor-pointer"
            >
              CHANGE
            </button>
          </div>
        </div>

        {/* Companion Customization Section */}
        <div className="border-2 border-rosepine-overlay bg-rosepine-surface p-4 rounded">
          <div className="flex items-center gap-2 text-rosepine-gold mb-3">
            <Smile className="w-4 h-4" />
            <span className="text-sm font-press uppercase">Companion Configuration</span>
          </div>
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-mono text-rosepine-muted mb-1.5 uppercase">
                Assign Name to Companion:
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  maxLength={12}
                  className="flex-1 bg-rosepine-base border-2 border-rosepine-overlay px-3 py-1.5 font-mono text-xs rounded outline-none focus:border-rosepine-rose"
                  placeholder="Companion name"
                />
                <button
                  onClick={handleSaveName}
                  className="px-4 py-1.5 border-2 border-rosepine-overlay bg-rosepine-overlay text-rosepine-rose hover:bg-rosepine-muted/30 text-xs tracking-wider font-press transition-colors rounded cursor-pointer"
                >
                  SAVE
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-mono text-rosepine-muted mb-1.5 uppercase">
                Visual Aesthetic Tone:
              </label>
              <div className="flex gap-2">
                <button
                  onClick={() => setTheme('dark')}
                  className={`flex-1 flex items-center justify-center gap-2 py-2 border-2 rounded text-xs font-press cursor-pointer ${
                    theme === 'dark'
                      ? 'border-rosepine-rose bg-rosepine-overlay text-rosepine-rose'
                      : 'border-rosepine-overlay bg-rosepine-base hover:bg-rosepine-overlay/40 text-rosepine-muted'
                  }`}
                >
                  <Moon className="w-3.5 h-3.5" />
                  ROSEPINE MAIN
                </button>
                <button
                  onClick={() => setTheme('light')}
                  className={`flex-1 flex items-center justify-center gap-2 py-2 border-2 rounded text-xs font-press cursor-pointer ${
                    theme === 'light'
                      ? 'border-rosepine-rose bg-rosepine-overlay text-rosepine-rose'
                      : 'border-rosepine-overlay bg-rosepine-base hover:bg-rosepine-overlay/40 text-rosepine-muted'
                  }`}
                >
                  <Sun className="w-3.5 h-3.5" />
                  ROSEPINE DAWN
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Co-fi Audio Synthesizer */}
        <div className="border-2 border-rosepine-overlay bg-rosepine-surface p-4 rounded">
          <div className="flex items-center gap-2 text-rosepine-pine mb-3">
            <Volume2 className="w-4 h-4" />
            <span className="text-sm font-press uppercase">Lo-fi Synth Engine</span>
          </div>
          <p className="text-xs font-mono text-rosepine-subtle mb-3 leading-relaxed">
            Generate private background lo-fi synth waves right inside your browser session to enhance your focus and relaxation while chatting.
          </p>
          <div className="flex flex-col gap-3">
            <button
              onClick={handleToggleLofi}
              className={`w-full py-2.5 border-2 rounded text-xs font-press flex items-center justify-center gap-2 transition-all cursor-pointer ${
                isPlayingLofi 
                  ? 'bg-rosepine-love/20 border-rosepine-love text-rosepine-love animate-pulse'
                  : 'bg-rosepine-base border-rosepine-overlay hover:bg-rosepine-overlay text-rosepine-text'
              }`}
            >
              {isPlayingLofi ? (
                <>
                  <Volume2 className="w-4 h-4" />
                  STOP LO-FI SYNTH CHORDS
                </>
              ) : (
                <>
                  <VolumeX className="w-4 h-4" />
                  PLAY COZY CHORD LOOPS
                </>
              )}
            </button>
            {isPlayingLofi && (
              <div className="flex items-center gap-3 bg-rosepine-base p-2 border border-rosepine-overlay rounded animate-fadeIn">
                <span className="text-xs font-mono text-rosepine-muted">VOL:</span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={lofiVolume}
                  onChange={handleVolumeChange}
                  className="flex-1 accent-rosepine-love cursor-pointer bg-rosepine-overlay h-1"
                />
                <span className="text-xs font-mono text-rosepine-rose w-8 text-right">{lofiVolume}%</span>
              </div>
            )}
          </div>
        </div>

        {/* Direct Storage Explorer Section */}
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
              <Download className="w-3.5 h-3.5" />
              EXPORT BACKUP
            </button>
            <button
              onClick={onImportSampleData}
              className="flex items-center justify-center gap-2 p-2 border-2 border-rosepine-overlay bg-rosepine-base hover:bg-rosepine-overlay rounded text-xs font-press text-rosepine-gold transition-colors cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              RESET TEMPLATE
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
                <Trash2 className="w-3.5 h-3.5" />
                PURGE DIRECT STORAGE
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
