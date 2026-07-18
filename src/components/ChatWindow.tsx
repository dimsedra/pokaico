import React, { useState, useRef, useEffect } from 'react';
import { ChatSession, ExpressionType } from '../types';
import { Image, Cpu, Check, AlertCircle, Edit3, Trash2, Sparkles, RefreshCw } from 'lucide-react';
import { MarkdownRenderer } from './MarkdownRenderer';

interface ChatWindowProps {
  session: ChatSession | null;
  onSendMessage: (text: string, imageBase64?: string, imageMime?: string) => void;
  onUpdateSessionTitle: (title: string) => void;
  onDeleteSession: (id: string) => void;
  isGenerating: boolean;
  companionName: string;
  expression: ExpressionType;
  model: string;
  providerId: string;
  availableModels: string[];
  setModel: (model: string) => void;
  apiKeyMissing: boolean;
}

export const ChatWindow: React.FC<ChatWindowProps> = ({
  session,
  onSendMessage,
  onUpdateSessionTitle,
  onDeleteSession,
  isGenerating,
  companionName,
  model,
  providerId,
  availableModels,
  setModel,
  apiKeyMissing
}) => {
  const getEnvKeyName = (prov: string) => {
    if (prov === 'google') return 'GEMINI_API_KEY';
    if (prov === 'opencode' || prov === 'opencode-go') return 'OPENCODE_API_KEY';
    if (prov === 'openai') return 'OPENAI_API_KEY';
    if (prov === 'anthropic') return 'ANTHROPIC_API_KEY';
    if (prov === 'xai') return 'XAI_API_KEY';
    if (prov === 'moonshotai') return 'MOONSHOT_API_KEY';
    if (prov === 'zai') return 'ZAI_API_KEY';
    if (prov === 'deepseek') return 'DEEPSEEK_API_KEY';
    if (prov === 'openrouter') return 'OPENROUTER_API_KEY';
    return `${prov.toUpperCase()}_API_KEY`;
  };

  const envKey = getEnvKeyName(providerId);
  const dropdownModels = Array.from(new Set(['pokaico-local', ...availableModels]));
  const [inputText, setInputText] = useState('');
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleInput, setTitleInput] = useState('');
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  
  // Local state for image upload preview
  const [uploadedImage, setUploadedImage] = useState<{ base64: string; mime: string } | null>(null);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);

  const handleCopyMessage = async (messageId: string, rawText: string) => {
    try {
      const textToCopy = rawText.includes('[Attached Image]')
        ? rawText.split('[Attached Image]')[0]?.trim() || 'Attached an image.'
        : rawText;
      await navigator.clipboard.writeText(textToCopy);
      setCopiedMessageId(messageId);
      setTimeout(() => setCopiedMessageId(null), 2000);
    } catch (err) {
      console.error('Failed to copy message:', err);
    }
  };

  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);


  useEffect(() => {
    if (session) {
      setTitleInput(session.title);
    }
    setUploadedImage(null);
  }, [session]);

  // Auto scroll to bottom
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [session?.messages, isGenerating]);

  const handleSend = () => {
    if (!inputText.trim() && !uploadedImage) return;
    
    onSendMessage(
      inputText.trim(),
      uploadedImage?.base64,
      uploadedImage?.mime
    );
    
    setInputText('');
    setUploadedImage(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleSend();
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        const commaIndex = result.indexOf(',');
        const base64 = result.substring(commaIndex + 1);
        setUploadedImage({
          base64,
          mime: file.type
        });
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSaveTitle = () => {
    if (session && titleInput.trim()) {
      onUpdateSessionTitle(titleInput.trim());
      setIsEditingTitle(false);
    }
  };

  const selectModel = (selectedModel: string) => {
    setModel(selectedModel);
    setShowModelDropdown(false);
  };

  const getModelLabel = (mKey: string) => {
    if (mKey === 'pokaico-local') return 'POKAICO OFFLINE (LOCAL)';
    // Remove provider prefix if present, then replace hyphens with spaces and capitalize
    const cleanName = mKey.replace(/^[a-zA-Z0-9-]+\//, '');
    return cleanName.replace(/-/g, ' ').toUpperCase();
  };

  if (!session) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 bg-rosepine-base font-pixel text-rosepine-text">
        <div className="border-4 border-rosepine-overlay bg-rosepine-surface p-8 max-w-md w-full text-center rounded shadow-[4px_4px_0px_0px_var(--rosepine-overlay)]">
          <Sparkles className="w-12 h-12 text-rosepine-gold mx-auto mb-4 animate-shroom-pulse" />
          <h2 className="text-3xl mb-2 tracking-wider">WELCOME TO POKAICO</h2>
          <p className="text-xs font-mono text-rosepine-subtle mb-6 leading-relaxed">
            A safe, private haven for your thoughts. Choose an existing journal or start a brand new cozy chat session.
          </p>
          <div className="w-16 h-1 bg-rosepine-rose mx-auto mb-4 rounded" />
          <span className="text-[10px] font-mono text-rosepine-muted uppercase block">
            Direct Storage Engine Status: ONLINE
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full bg-rosepine-base font-pixel overflow-hidden">
      
      {/* Top Header - Session Title Center */}
      <div className="h-16 border-b-4 border-rosepine-overlay bg-rosepine-surface px-6 flex items-center justify-between flex-shrink-0">
        <div className="w-12" /> {/* Left balancer spacer */}
        
        {/* Title Center */}
        <div className="flex items-center gap-2 max-w-md">
          {isEditingTitle ? (
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={titleInput}
                onChange={(e) => setTitleInput(e.target.value)}
                maxLength={24}
                className="bg-rosepine-base border-2 border-rosepine-overlay px-2 py-0.5 font-mono text-xs text-rosepine-text rounded outline-none w-48 text-center"
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && handleSaveTitle()}
              />
              <button onClick={handleSaveTitle} className="text-rosepine-foam hover:text-rosepine-pine cursor-pointer">
                <Check className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <h2 className="text-xl tracking-widest text-rosepine-gold text-center truncate uppercase">
                {session.title}
              </h2>
              <button 
                onClick={() => setIsEditingTitle(true)}
                className="text-rosepine-muted hover:text-rosepine-rose transition-colors cursor-pointer"
              >
                <Edit3 className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>

        {/* Delete button (on Right) */}
        <button
          onClick={() => onDeleteSession(session.id)}
          className="text-rosepine-muted hover:text-rosepine-love p-1.5 rounded transition-colors cursor-pointer"
          title="Delete chat session"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {/* API Key Missing Notification Banner */}
      {apiKeyMissing && model !== 'pokaico-local' && (
        <div className="bg-rosepine-gold/10 border-b-2 border-rosepine-gold/40 px-6 py-2 flex items-center gap-3 flex-shrink-0 animate-fadeIn">
          <AlertCircle className="w-5 h-5 text-rosepine-gold flex-shrink-0" />
          <div className="text-[11px] font-mono text-rosepine-gold">
            <span className="font-bold uppercase">No {envKey} found!</span> Pokaico is operating in <span className="underline">Offline Local mode</span>. Configure an API key in <span className="font-semibold">Settings</span> to activate the full AI core.
          </div>
        </div>
      )}

      {/* Messages Feed Wrapper */}
      <div className="flex-1 relative overflow-hidden">
        {/* Messages Feed */}
        <div className="w-full h-full overflow-y-auto p-6 space-y-6">
          {session.messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center text-rosepine-muted font-mono py-12">
              <div className="border border-dashed border-rosepine-overlay p-4 rounded max-w-sm">
                <Sparkles className="w-5 h-5 text-rosepine-rose mx-auto mb-2 animate-pulse" />
                <p className="text-xs">
                  A blank canvas. Say hello to {companionName}! You can share your feelings, discuss your day, or even upload an image.
                </p>
              </div>
            </div>
          ) : (
            session.messages.map((m) => {
              const isUser = m.sender === 'user';
              return (
                <div
                  key={m.id}
                  className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} animate-fadeIn`}
                >
                  {/* Sender Tag Header */}
                  <div className="flex items-center gap-2 text-[10px] font-mono text-rosepine-muted mb-1.5 uppercase tracking-wider px-1 select-none">
                    <span>{isUser ? 'User' : companionName} • {m.timestamp}</span>
                    <span>•</span>
                    <button
                      onClick={() => handleCopyMessage(m.id, m.text)}
                      className="hover:text-rosepine-rose transition-colors duration-150 cursor-pointer uppercase font-bold text-[9px] border-b border-dashed border-rosepine-muted hover:border-rosepine-rose"
                    >
                      {copiedMessageId === m.id ? 'Copied!' : 'Copy'}
                    </button>
                  </div>

                  {/* retro square message bubble */}
                  <div
                    className={`max-w-xl p-4 border-4 rounded-md shadow-[3px_3px_0px_0px_var(--rosepine-overlay)] transition-transform duration-100 select-text ${
                      isUser
                        ? 'bg-rosepine-overlay border-rosepine-subtle text-rosepine-text'
                        : 'bg-rosepine-surface border-rosepine-overlay text-rosepine-text'
                    }`}
                  >
                    {/* Handle base64 image render inside retro message block */}
                    {isUser && m.text.includes('[Attached Image]') && (
                      <div className="mb-3 border-2 border-rosepine-overlay rounded overflow-hidden max-w-xs bg-rosepine-base">
                        <div className="bg-rosepine-overlay/40 p-1 border-b border-rosepine-overlay flex items-center gap-1.5 text-[9px] font-mono text-rosepine-muted">
                          <Image className="w-3 h-3 text-rosepine-gold" />
                          DIRECT_LOG_IMAGE.PNG
                        </div>
                        <img
                          src={`data:image/png;base64,${m.text.split('[Attached Image]')[1]?.trim()}`}
                          alt="Uploaded log content"
                          className="w-full h-auto"
                          referrerPolicy="no-referrer"
                        />
                      </div>
                    )}

                    <MarkdownRenderer
                      content={
                        isUser && m.text.includes('[Attached Image]')
                          ? m.text.split('[Attached Image]')[0]?.trim() || 'Attached an image.'
                          : m.text
                      }
                    />
                  </div>
                </div>
              );
            })
          )}

          {/* Dynamic Thinking/Loading message bubble */}
          {isGenerating && (
            <div className="flex flex-col items-start animate-fadeIn">
              <span className="text-[10px] font-mono text-rosepine-gold mb-1.5 uppercase tracking-wider px-1 animate-pulse">
                {companionName} is typing...
              </span>
              <div className="bg-rosepine-surface border-4 border-rosepine-gold p-4 rounded-md max-w-xs shadow-[3px_3px_0px_0px_var(--rosepine-overlay)] flex items-center gap-3">
                <RefreshCw className="w-4 h-4 text-rosepine-gold animate-spin" />
                <span className="text-xs font-mono text-rosepine-gold uppercase tracking-wider animate-pulse">
                  Accessing Memory Core
                </span>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
        {/* Static Scanline Overlay */}
        <div 
          className="pointer-events-none absolute inset-0 z-10 select-none" 
          style={{
            background: 'linear-gradient(rgba(18, 16, 16, 0) 50%, rgba(0, 0, 0, 0.12) 50%)',
            backgroundSize: '100% 4px',
          }}
        />
      </div>

      {/* Upload image preview bar */}
      {uploadedImage && (
        <div className="px-6 py-2 border-t-2 border-rosepine-overlay/40 bg-rosepine-surface flex items-center justify-between animate-fadeIn flex-shrink-0">
          <div className="flex items-center gap-2">
            <Image className="w-4 h-4 text-rosepine-rose" />
            <span className="text-xs font-mono text-rosepine-rose uppercase">
              1 Image Stage Loaded (Will send with message)
            </span>
          </div>
          <button
            onClick={() => setUploadedImage(null)}
            className="text-xs text-rosepine-love hover:underline font-mono cursor-pointer"
          >
            [REMOVE]
          </button>
        </div>
      )}

      {/* Chat Input / Action Bar */}
      <div className="p-6 border-t-4 border-rosepine-overlay bg-rosepine-surface flex-shrink-0">
        <div className="flex items-center gap-3 relative">
          
          {/* File Upload Button */}
          <button
            onClick={() => fileInputRef.current?.click()}
            className="p-3 border-2 border-rosepine-overlay bg-rosepine-base hover:bg-rosepine-overlay text-rosepine-text transition-colors rounded hover:text-rosepine-rose shadow-[2px_2px_0px_0px_var(--rosepine-overlay)] cursor-pointer"
            title="Upload snapshot"
          >
            <Image className="w-5 h-5" />
          </button>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            accept="image/*"
            className="hidden"
          />

          {/* Core Text Input area */}
          <div className="flex-1 relative flex items-center bg-rosepine-base border-2 border-rosepine-overlay rounded shadow-[2px_2px_0px_0px_var(--rosepine-overlay)]">
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isGenerating}
              className="w-full bg-transparent px-4 py-3 font-mono text-sm text-rosepine-text outline-none placeholder:text-rosepine-muted"
              placeholder={`Write something cozy to ${companionName}...`}
            />
            {inputText === '' && !isGenerating && (
              <span className="absolute right-4 text-rosepine-muted text-xs animate-pulse font-mono">
                LO-FI TERMINAL ONLINE
              </span>
            )}
          </div>

          {/* Model Selector Dropdown Button */}
          <div className="relative">
            <button
              onClick={() => setShowModelDropdown(!showModelDropdown)}
              className="p-3 border-2 border-rosepine-overlay bg-rosepine-base hover:bg-rosepine-overlay text-rosepine-text transition-colors rounded flex items-center gap-1.5 shadow-[2px_2px_0px_0px_var(--rosepine-overlay)] cursor-pointer"
              title="Select companion core engine"
            >
              <Cpu className="w-5 h-5 text-rosepine-gold" />
            </button>
            
            {showModelDropdown && (
              <div className="absolute bottom-14 right-0 w-64 bg-rosepine-surface border-4 border-rosepine-overlay rounded p-2 z-30 shadow-[4px_4px_0px_0px_var(--rosepine-overlay)] animate-fadeIn">
                <span className="text-[9px] font-mono text-rosepine-muted block mb-1.5 uppercase px-1">
                  Companion AI Engine:
                </span>
                <div className="space-y-1">
                  {dropdownModels.map((mKey) => (
                    <button
                      key={mKey}
                      onClick={() => selectModel(mKey)}
                      className={`w-full text-left px-2 py-1.5 rounded text-[10px] font-press tracking-tighter truncate transition-colors cursor-pointer ${
                        model === mKey
                          ? 'bg-rosepine-overlay text-rosepine-rose'
                          : 'hover:bg-rosepine-base text-rosepine-text'
                      }`}
                      title={mKey}
                    >
                      {getModelLabel(mKey)}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Send Button */}
          <button
            onClick={handleSend}
            disabled={isGenerating || (!inputText.trim() && !uploadedImage)}
            className="px-6 py-3 border-2 border-rosepine-overlay bg-rosepine-overlay hover:bg-rosepine-muted/30 text-rosepine-rose disabled:opacity-50 transition-colors font-press text-xs tracking-wider rounded shadow-[2px_2px_0px_0px_var(--rosepine-overlay)] active:translate-y-0.5 cursor-pointer"
          >
            SEND
          </button>

        </div>
      </div>

    </div>
  );
};
