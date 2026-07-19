import React from 'react';
import { ChatSession } from '../types';
import { Plus, Network, Settings, MessageSquare, Pin } from 'lucide-react';

interface LeftSidebarProps {
  sessions: ChatSession[];
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
  onNewChat: () => void;
  onTogglePinSession?: (id: string, currentPinned: boolean) => void;
  activeView: 'chat' | 'graph' | 'settings';
  setActiveView: (view: 'chat' | 'graph' | 'settings') => void;
}

export const LeftSidebar: React.FC<LeftSidebarProps> = ({
  sessions,
  activeSessionId,
  onSelectSession,
  onNewChat,
  onTogglePinSession,
  activeView,
  setActiveView
}) => {
  const pinnedSessions = sessions.filter((s) => !!s.pinned);
  const unpinnedSessions = sessions.filter((s) => !s.pinned);

  const renderSessionItem = (s: ChatSession) => {
    const isActive = activeSessionId === s.id && activeView === 'chat';
    const isPinned = !!s.pinned;

    return (
      <div
        key={s.id}
        onClick={() => {
          onSelectSession(s.id);
          setActiveView('chat');
        }}
        className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-left rounded text-xs transition-colors group cursor-pointer ${
          isActive
            ? 'bg-rosepine-overlay text-rosepine-rose border-l-4 border-rosepine-rose'
            : 'bg-rosepine-base/50 hover:bg-rosepine-base text-rosepine-text border-l-4 border-transparent'
        }`}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <MessageSquare className={`w-3.5 h-3.5 flex-shrink-0 ${isActive ? 'text-rosepine-rose' : 'text-rosepine-muted'}`} />
          <span className="truncate font-mono">{s.title || 'Untitled Journal'}</span>
        </div>

        {onTogglePinSession && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onTogglePinSession(s.id, isPinned);
            }}
            className={`p-1 rounded transition-opacity ${
              isPinned
                ? 'text-rosepine-gold opacity-100'
                : 'text-rosepine-muted opacity-0 group-hover:opacity-100 hover:text-rosepine-gold'
            }`}
            title={isPinned ? 'Unpin Journal' : 'Pin Journal'}
          >
            <Pin className={`w-3.5 h-3.5 ${isPinned ? 'fill-rosepine-gold' : ''}`} />
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="w-64 border-r-4 border-rosepine-overlay bg-rosepine-surface flex flex-col h-full font-pixel select-none">
      {/* Top Section - Brand and New Chat */}
      <div className="p-4 border-b-4 border-rosepine-overlay">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-3.5 h-3.5 bg-rosepine-love rounded-full animate-pulse" />
          <h1 className="text-2xl font-semibold tracking-widest text-rosepine-rose">
            POKAICO
          </h1>
        </div>
        
        <button
          onClick={onNewChat}
          className="w-full flex items-center justify-center gap-2 py-2 border-2 border-rosepine-overlay bg-rosepine-base hover:bg-rosepine-overlay text-rosepine-text text-xs tracking-wider transition-all duration-150 active:translate-y-0.5 rounded shadow-[2px_2px_0px_0px_var(--rosepine-overlay)] cursor-pointer"
        >
          <Plus className="w-4 h-4 text-rosepine-rose" />
          NEW CHAT
        </button>
      </div>

      {/* Middle Section - Chat History List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Pinned Section */}
        {pinnedSessions.length > 0 && (
          <div className="space-y-1.5">
            <span className="text-[10px] font-press text-rosepine-gold uppercase tracking-wider flex items-center gap-1.5 mb-1">
              <Pin className="w-3 h-3 fill-rosepine-gold" />
              PINNED ({pinnedSessions.length})
            </span>
            <div className="space-y-1.5">
              {pinnedSessions.map(renderSessionItem)}
            </div>
          </div>
        )}

        {/* Regular Chat History */}
        <div className="space-y-1.5">
          <span className="text-xs font-mono text-rosepine-muted uppercase tracking-wider block mb-1">
            {pinnedSessions.length > 0 ? 'OTHER JOURNALS' : `CHAT HISTORY (${sessions.length})`}
          </span>

          <div className="space-y-1.5">
            {unpinnedSessions.map(renderSessionItem)}

            {sessions.length === 0 && (
              <div className="text-center py-6 text-xs text-rosepine-muted font-mono leading-relaxed">
                No previous journals.
                <br />
                Click 'New Chat' above!
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bottom Controls Panel */}
      <div className="p-4 border-t-4 border-rosepine-overlay bg-rosepine-base/40 flex items-center justify-between">
        {/* Traverse Graph Option */}
        <button
          onClick={() => setActiveView('graph')}
          className={`flex items-center gap-1.5 px-3 py-2 border-2 rounded text-xs tracking-wider transition-colors uppercase cursor-pointer ${
            activeView === 'graph'
              ? 'border-rosepine-gold bg-rosepine-overlay text-rosepine-gold'
              : 'border-rosepine-overlay bg-rosepine-base hover:bg-rosepine-overlay text-rosepine-muted'
          }`}
          title="Traverse Pokaico Memory Graph"
        >
          <Network className="w-4 h-4" />
          GRAPH
        </button>

        {/* Settings Option */}
        <button
          onClick={() => setActiveView('settings')}
          className={`p-2 border-2 rounded transition-colors cursor-pointer ${
            activeView === 'settings'
              ? 'border-rosepine-rose bg-rosepine-overlay text-rosepine-rose'
              : 'border-rosepine-overlay bg-rosepine-base hover:bg-rosepine-overlay text-rosepine-muted'
          }`}
          title="Pokaico Settings"
        >
          <Settings className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
