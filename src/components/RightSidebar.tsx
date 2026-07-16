import React, { useState } from 'react';
import { DiaryEntry, CompanionState } from '../types';
import { ShroomSprite } from './ShroomSprite';
import { BookOpen, Plus, Calendar, RefreshCw, X } from 'lucide-react';

interface RightSidebarProps {
  companionState: CompanionState;
  diaries: DiaryEntry[];
  onTriggerDiary: () => void;
  isTriggeringDiary: boolean;
}

export const RightSidebar: React.FC<RightSidebarProps> = ({
  companionState,
  diaries,
  onTriggerDiary,
  isTriggeringDiary
}) => {
  const [selectedDiary, setSelectedDiary] = useState<DiaryEntry | null>(null);

  // EXP progress percentage
  const expPercent = Math.min(100, Math.max(0, (companionState.exp / 100) * 100));

  return (
    <div className="w-80 border-l-4 border-rosepine-overlay bg-rosepine-surface flex flex-col h-full font-pixel select-none">
      
      {/* Top Part - Terrarium & Companion Sprite */}
      <div className="p-4 border-b-4 border-rosepine-overlay flex flex-col items-center text-center">
        <span className="text-xs font-mono text-rosepine-muted uppercase tracking-wider mb-2">
          COMPANION TERRARIUM
        </span>

        {/* The cozy pixel terrarium container */}
        <div className="w-full bg-rosepine-base border-4 border-rosepine-overlay rounded p-4 mb-3 flex flex-col items-center justify-center relative overflow-hidden">
          {/* Grassy floor base inside terrarium */}
          <div className="absolute bottom-0 left-0 right-0 h-4 bg-rosepine-pine/20 border-t border-rosepine-pine/40" />
          
          <ShroomSprite 
            expression={companionState.expression} 
            size={120} 
            className="z-10"
          />

          {/* Current Expression Label Tag */}
          <span className="z-10 mt-2 bg-rosepine-overlay text-rosepine-gold text-[10px] font-press px-2 py-0.5 rounded border border-rosepine-gold/30">
            {companionState.expression.toUpperCase()}
          </span>
        </div>

        {/* Companion Meta / RPG-style Growth stats */}
        <div className="w-full bg-rosepine-base/40 p-2.5 border-2 border-rosepine-overlay rounded text-left space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-rosepine-rose font-press">
              {companionState.name}
            </span>
            <span className="text-xs font-press text-rosepine-gold bg-rosepine-overlay px-1.5 py-0.5 rounded">
              LVL {companionState.level}
            </span>
          </div>

          {/* EXP Growth bar */}
          <div className="space-y-1">
            <div className="flex justify-between text-[10px] font-mono text-rosepine-muted">
              <span>EXP PIPELINE:</span>
              <span>{companionState.exp}/100</span>
            </div>
            <div className="w-full h-3 bg-rosepine-base border-2 border-rosepine-overlay rounded overflow-hidden p-0.5">
              <div 
                className="h-full bg-rosepine-rose transition-all duration-300"
                style={{ width: `${expPercent}%` }}
              />
            </div>
          </div>

          <div className="text-xs text-rosepine-foam font-mono italic text-center mt-1">
            "{companionState.moodText}"
          </div>
        </div>
      </div>

      {/* Bottom Part - Diary keeping */}
      <div className="flex-1 p-4 flex flex-col min-h-0">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5 text-rosepine-rose">
            <BookOpen className="w-4 h-4" />
            <span className="text-xs font-press uppercase">AI Companion Diaries</span>
          </div>
          
          <button
            onClick={onTriggerDiary}
            disabled={isTriggeringDiary}
            className="p-1 border border-rosepine-overlay bg-rosepine-base hover:bg-rosepine-overlay rounded text-rosepine-gold disabled:opacity-50 transition-colors cursor-pointer"
            title="Generate a new AI summary diary entry based on today's chat"
          >
            {isTriggeringDiary ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Plus className="w-3.5 h-3.5" />
            )}
          </button>
        </div>

        {/* List of diaries written by AI */}
        <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
          {diaries.map((d) => (
            <button
              key={d.id}
              onClick={() => setSelectedDiary(d)}
              className="w-full text-left bg-rosepine-base hover:bg-rosepine-overlay border-2 border-rosepine-overlay p-3 rounded group transition-all duration-150 active:translate-y-0.5 cursor-pointer"
            >
              <div className="flex items-center justify-between text-[10px] text-rosepine-muted font-mono mb-1">
                <span className="flex items-center gap-1">
                  <Calendar className="w-3 h-3 text-rosepine-foam" />
                  {d.date}
                </span>
                <span className="bg-rosepine-overlay/50 px-1 py-0.5 rounded text-[8px] uppercase">
                  {d.sentiment}
                </span>
              </div>
              <h4 className="text-xs font-press text-rosepine-gold group-hover:text-rosepine-rose transition-colors truncate">
                {d.title}
              </h4>
              <p className="text-xs text-rosepine-subtle font-mono line-clamp-2 mt-1 leading-relaxed">
                {d.content}
              </p>
            </button>
          ))}

          {diaries.length === 0 && (
            <div className="text-center py-12 text-xs text-rosepine-muted font-mono bg-rosepine-base/20 border border-dashed border-rosepine-overlay/40 rounded">
              No diaries written yet.
              <br />
              {isTriggeringDiary ? (
                <span className="text-rosepine-gold animate-pulse">Generating your summary...</span>
              ) : (
                <span className="text-[10px] block mt-1 text-rosepine-subtle">
                  Tap [+] above to generate a private diary entry summarizing your chats!
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Floating Book Diary Overlay modal */}
      {selectedDiary && (
        <div className="fixed inset-0 bg-rosepine-base/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-rosepine-surface border-4 border-rosepine-overlay rounded max-w-md w-full p-6 relative shadow-[4px_4px_0px_0px_var(--rosepine-overlay)] font-pixel animate-shroom-pulse">
            <button
              onClick={() => setSelectedDiary(null)}
              className="absolute top-3 right-3 text-rosepine-muted hover:text-rosepine-love transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2 text-rosepine-gold mb-3">
              <BookOpen className="w-5 h-5" />
              <span className="text-xs font-press uppercase">Companion Memory Log</span>
            </div>

            <div className="border-b-2 border-rosepine-overlay/40 pb-3 mb-4">
              <span className="text-xs text-rosepine-foam font-mono">{selectedDiary.date}</span>
              <h3 className="text-lg font-press text-rosepine-rose mt-1">
                {selectedDiary.title}
              </h3>
            </div>

            <div className="bg-rosepine-base p-4 border-2 border-rosepine-overlay text-rosepine-text rounded text-sm font-mono max-h-60 overflow-y-auto leading-relaxed whitespace-pre-wrap">
              {selectedDiary.content}
            </div>

            <div className="mt-4 flex justify-between items-center text-xs font-mono text-rosepine-muted">
              <span>Sentiment: <span className="text-rosepine-gold uppercase font-bold">{selectedDiary.sentiment}</span></span>
              <button
                onClick={() => setSelectedDiary(null)}
                className="px-4 py-1.5 border-2 border-rosepine-overlay bg-rosepine-overlay text-rosepine-text hover:bg-rosepine-muted text-xs font-press rounded cursor-pointer"
              >
                CLOSE
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
