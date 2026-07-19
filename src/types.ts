export type ExpressionType = 'idle' | 'happy' | 'thinking' | 'loading' | 'error' | 'excited' | 'sad';

export interface Message {
  id: string;
  sender: 'user' | 'pokaico';
  text: string;
  timestamp: string;
  expression?: ExpressionType;
}

export interface ChatSession {
  id: string;
  title: string;
  messages: Message[];
  createdAt: string;
}

export interface MemoryItem {
  id: string;
  category: string;
  details: string;
  learnedAt: string;
}

export interface DiaryEntry {
  id: string;
  title: string;
  content: string;
  sentiment: 'cozy' | 'excited' | 'reflective' | 'supportive';
  date: string;
}

export interface CompanionState {
  name: string;
  expression: ExpressionType;
  level: number;
  exp: number;
  moodText: string;
}

// ─────────────────────────────────────────────────────────
// Procedural Sprite Framework Interfaces (64x64)
// ─────────────────────────────────────────────────────────

export interface SpritePixel {
  rx: number; // Relative X to pivot (X=32)
  ry: number; // Relative Y to pivot (Y=54)
  type: string; // Color category key (e.g. 'cap', 'stalk', 'eye', etc.)
}

export interface SpriteDeformation {
  scaleX: number;
  scaleY: number;
  rotation: number;
  offsetX: number;
  offsetY: number;
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  alpha: number;
  life: number;
  maxLife: number;
  size: number;
}

export interface CustomizationOptionField {
  id: string;
  label: string;
  type: 'color' | 'select' | 'boolean' | 'number';
  category: string;
  defaultValue: any;
  options?: { label: string; value: string }[];
  min?: number;
  max?: number;
  step?: number;
}

export type CustomizationOptions = Record<string, any>;

export interface ProceduralSpriteTemplate {
  id: string;
  name: string;
  resolution: number; // e.g. 64
  pivotX: number;     // e.g. 32
  pivotY: number;     // e.g. 54
  customizationSchema: CustomizationOptionField[];
  defaultOptions: CustomizationOptions;
  getBasePixels: (options: CustomizationOptions) => SpritePixel[];
  getDeformation: (state: ExpressionType, time: number) => SpriteDeformation;
  getPalette: (options: CustomizationOptions) => Record<string, string>;
  getParticles?: (state: ExpressionType, time: number, pivotX: number, pivotY: number) => Particle[];
  drawFace?: (
    ctx: CanvasRenderingContext2D,
    state: ExpressionType,
    time: number,
    pivotX: number,
    pivotY: number,
    pixelScale: number,
    options: CustomizationOptions
  ) => void;
}
