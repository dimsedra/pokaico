import React from 'react';
import { ChatSession } from '../types';
import { Plus, Network, Settings, MessageSquare } from 'lucide-react';

interface LeftSidebarProps {
  sessions: ChatSession[];
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
  onNewChat: () => void;
  activeView: 'chat' | 'graph' | 'settings';
  setActiveView: (view: 'chat' | 'graph' | 'settings') => void;
}

export const LeftSidebar: React.FC<LeftSidebarProps> = ({
  sessions,
  activeSessionId,
  onSelectSession,
  onNewChat,
  activeView,
  setActiveView
}) => {
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
          className="w-full flex items-center justify-center gap-2 py-2 border-2 border-rosepine-overlay bg-rosepine-base hover:bg-rosepine-overlay text-rosepine-text text-xs tracking-wider transition-all duration-150 active:translate-y-0.5 rounded shadow-[2px_2px_0px_0px_var(--rosepine-overlay)]"
        >
          <Plus className="w-4 h-4 text-rosepine-rose" />
          NEW CHAT
        </button>
      </div>

      {/* Middle Section - Chat History List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        <span className="text-xs font-mono text-rosepine-muted uppercase tracking-wider block mb-1">
          Chat History ({sessions.length})
        </span>
        
        <div className="space-y-2">
          {sessions.map((s) => {
            const isActive = activeSessionId === s.id && activeView === 'chat';
            return (
              <button
                key={s.id}
                onClick={() => {
                  onSelectSession(s.id);
                  setActiveView('chat');
                }}
                className={`w-full flex items-center gap-2 px-3 py-2 text-left rounded text-xs transition-colors group ${
                  isActive
                    ? 'bg-rosepine-overlay text-rosepine-rose border-l-4 border-rosepine-rose'
                    : 'bg-rosepine-base/50 hover:bg-rosepine-base text-rosepine-text border-l-4 border-transparent'
                }`}
              >
                <MessageSquare className={`w-3.5 h-3.5 flex-shrink-0 ${isActive ? 'text-rosepine-rose' : 'text-rosepine-muted'}`} />
                <span className="truncate flex-1 font-mono">{s.title || "Untitled Journal"}</span>
              </button>
            );
          })}

          {sessions.length === 0 && (
            <div className="text-center py-6 text-xs text-rosepine-muted font-mono leading-relaxed">
              No previous journals.
              <br />
              Click 'New Chat' above!
            </div>
          )}
        </div>
      </div>

      {/* Bottom Controls Panel */}
      <div className="p-4 border-t-4 border-rosepine-overlay bg-rosepine-base/40 flex items-center justify-between">
        {/* Traverse Graph Option (on Left) */}
        <button
          onClick={() => setActiveView('graph')}
          className={`flex items-center gap-1.5 px-3 py-2 border-2 rounded text-xs tracking-wider transition-colors uppercase ${
            activeView === 'graph'
              ? 'border-rosepine-gold bg-rosepine-overlay text-rosepine-gold'
              : 'border-rosepine-overlay bg-rosepine-base hover:bg-rosepine-overlay text-rosepine-muted'
          }`}
          title="Traverse Pokaico Memory Graph"
        >
          <Network className="w-4 h-4" />
          GRAPH
        </button>

        {/* Settings Option (on Bottom Right) */}
        <button
          onClick={() => setActiveView('settings')}
          className={`p-2 border-2 rounded transition-colors ${
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
