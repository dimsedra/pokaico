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
