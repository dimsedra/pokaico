import React, { useState } from 'react';
import { MemoryItem } from '../types';
import { Brain, Tag, Trash2, HelpCircle } from 'lucide-react';

interface MemoryGraphProps {
  memories: MemoryItem[];
  onDeleteMemory: (id: string) => void;
  onAddSampleMemory: () => void;
}

export const MemoryGraph: React.FC<MemoryGraphProps> = ({
  memories,
  onDeleteMemory,
  onAddSampleMemory
}) => {
  const [selectedNode, setSelectedNode] = useState<MemoryItem | null>(null);

  // Simple visual coordinate placement for SVG nodes so they spread out in a circle/radial layout
  const width = 500;
  const height = 300;
  const cx = width / 2;
  const cy = height / 2;
  const radius = 100;

  return (
    <div className="w-full h-full flex flex-col font-pixel p-6">
      <div className="flex items-center justify-between border-b-4 border-rosepine-overlay pb-3 mb-4">
        <div className="flex items-center gap-2">
          <Brain className="w-6 h-6 text-rosepine-gold" />
          <h2 className="text-2xl tracking-wider text-rosepine-text">POKAICO MEMORY GRAPH</h2>
        </div>
        <div className="text-xs font-mono text-rosepine-muted bg-rosepine-overlay px-2 py-1 rounded">
          {memories.length} Pipeline Nodes
        </div>
      </div>

      <p className="text-sm font-mono text-rosepine-subtle mb-4 leading-relaxed">
        This is Pokaico's real-time memory pipeline. As you converse, the agent automatically extracts your preferences, habits, and feelings, linking them to grow with you.
      </p>

      {/* SVG Memory Canvas */}
      <div className="relative flex-1 bg-rosepine-base border-4 border-rosepine-overlay rounded p-1 overflow-hidden min-h-[300px]">
        {memories.length === 0 ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center font-mono">
            <HelpCircle className="w-10 h-10 text-rosepine-muted mb-2 animate-bounce" />
            <span className="text-rosepine-muted text-sm mb-4">Memory pipeline is empty. Converse with Pokaico to form memories!</span>
            <button
              onClick={onAddSampleMemory}
              className="px-4 py-2 border-2 border-rosepine-overlay bg-rosepine-surface hover:bg-rosepine-overlay text-rosepine-gold text-xs font-press tracking-wider transition-colors cursor-pointer"
            >
              SEED INITIAL MEMORIES
            </button>
          </div>
        ) : (
          <svg className="w-full h-full min-h-[300px]" viewBox={`0 0 ${width} ${height}`}>
            {/* Center Node (User / Pokaico Core) */}
            <g transform={`translate(${cx}, ${cy})`}>
              <line
                x1={0}
                y1={0}
                x2={0}
                y2={0}
                className="stroke-2 stroke-rosepine-overlay"
              />
              <circle r="22" fill="#26233a" className="stroke-2 stroke-rosepine-gold" />
              <rect x="-24" y="-24" width="48" height="48" fill="none" className="stroke-2 stroke-rosepine-gold" />
              <text
                textAnchor="middle"
                dy="4"
                className="fill-rosepine-gold text-xs font-press cursor-default select-none"
                style={{ fontSize: '8px' }}
              >
                CORE
              </text>
            </g>

            {/* Link Lines from Center to Memory Nodes */}
            {memories.map((m, index) => {
              const angle = (index * 2 * Math.PI) / memories.length;
              const x = cx + radius * Math.cos(angle);
              const y = cy + radius * Math.sin(angle);

              return (
                <line
                  key={`line-${m.id}`}
                  x1={cx}
                  y1={cy}
                  x2={x}
                  y2={y}
                  stroke="#6e6a86"
                  strokeWidth="2"
                  strokeDasharray="4 4"
                  className="opacity-70 hover:opacity-100 transition-opacity"
                />
              );
            })}

            {/* Memory Nodes */}
            {memories.map((m, index) => {
              const angle = (index * 2 * Math.PI) / memories.length;
              const x = cx + radius * Math.cos(angle);
              const y = cy + radius * Math.sin(angle);
              const isSelected = selectedNode?.id === m.id;

              return (
                <g
                  key={`node-${m.id}`}
                  transform={`translate(${x}, ${y})`}
                  onClick={() => setSelectedNode(m)}
                  className="cursor-pointer group"
                >
                  {/* Outer pixel border representation */}
                  <rect
                    x="-40"
                    y="-15"
                    width="80"
                    height="30"
                    fill={isSelected ? '#c4a7e7' : '#212030'}
                    stroke={isSelected ? '#faf4ed' : '#26233a'}
                    strokeWidth="2"
                    className="transition-colors group-hover:fill-rosepine-overlay"
                  />
                  {/* Category Pill label */}
                  <text
                    textAnchor="middle"
                    dy="-3"
                    className={isSelected ? 'fill-rosepine-base select-none' : 'fill-rosepine-rose select-none'}
                    style={{ fontSize: '10px', fontWeight: 'bold' }}
                  >
                    {m.category.toUpperCase()}
                  </text>
                  {/* Value Summary text truncated */}
                  <text
                    textAnchor="middle"
                    dy="10"
                    className={isSelected ? 'fill-rosepine-base font-mono select-none' : 'fill-rosepine-text font-mono select-none'}
                    style={{ fontSize: '9px' }}
                  >
                    {m.details.length > 12 ? `${m.details.substring(0, 10)}...` : m.details}
                  </text>
                </g>
              );
            })}
          </svg>
        )}
      </div>

      {/* Selected Node Details Terminal panel */}
      {selectedNode && (
        <div className="mt-4 border-4 border-rosepine-overlay bg-rosepine-surface p-4 rounded relative animate-fadeIn">
          <button
            onClick={() => setSelectedNode(null)}
            className="absolute top-2 right-2 text-rosepine-muted hover:text-rosepine-love text-sm font-bold font-mono cursor-pointer"
          >
            [X]
          </button>
          <div className="flex items-center gap-2 text-rosepine-love mb-2">
            <Tag className="w-4 h-4" />
            <h3 className="text-lg tracking-wider font-press font-semibold" style={{ fontSize: '11px' }}>
              MEMORY NODE DEFINITION
            </h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm font-mono text-rosepine-text mt-2">
            <div>
              <span className="text-rosepine-muted">Pipeline Type:</span>{' '}
              <span className="text-rosepine-rose font-semibold bg-rosepine-base px-1.5 py-0.5 rounded text-xs uppercase">
                {selectedNode.category}
              </span>
            </div>
            <div>
              <span className="text-rosepine-muted">Timestamp:</span>{' '}
              <span className="text-xs text-rosepine-foam">{selectedNode.learnedAt}</span>
            </div>
            <div className="md:col-span-2 mt-2">
              <span className="text-rosepine-muted block mb-1">Extracted Knowledge:</span>
              <div className="bg-rosepine-base p-2 border border-rosepine-overlay text-rosepine-gold rounded text-xs break-words">
                "{selectedNode.details}"
              </div>
            </div>
          </div>
          <div className="mt-4 flex justify-end">
            <button
              onClick={() => {
                onDeleteMemory(selectedNode.id);
                setSelectedNode(null);
              }}
              className="flex items-center gap-1.5 text-xs text-rosepine-love hover:bg-rosepine-love/10 px-2 py-1 border border-rosepine-love/30 rounded font-mono transition-colors cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete Memory Node
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
