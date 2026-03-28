import { GoogleGenAI } from "@google/genai";

export interface Character {
  id: string;
  name: string;
  description: string;
  images: string[]; // Base64 strings
  isDefault: boolean;
}

export interface Scene {
  id: string;
  sceneCode: string; // Column A
  lang1: string; // Column B
  vietnamese: string; // Column C
  promptName: string; // Column D
  description: string; // Column E (Mô tả bối cảnh)
  characterIds: string[]; // Column F
  generatedImage: string | null; // Base64 string
  isGenerating: boolean;
  refinedPrompt?: string;
}

export interface UsageEvent {
  id: string;
  timestamp: number;
  model: string;
  type: 'text' | 'image';
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
  actualCost: number;
  diffPercent: number;
}

export interface ProjectState {
  projectName: string;
  tabs: TabData[];
  activeTabId: string;
  apiKey: string | null;
  characters: Character[];
  scenes: Scene[];
  stylePrompt: string;
  usageStats: {
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCost: number;
  };
  usageHistory: UsageEvent[];
}

export interface TabData {
  id: string;
  title: string;
  content: any;
}

export interface HistoryState {
  past: ProjectState[];
  present: ProjectState;
  future: ProjectState[];
}

export const DEFAULT_PROJECT_STATE: ProjectState = {
  projectName: "",
  tabs: [
    { id: "tab1", title: "Nhân vật", content: {} },
    { id: "tab2", title: "Kịch bản", content: {} },
    { id: "tab3", title: "Chi phí", content: {} },
  ],
  activeTabId: "tab1",
  apiKey: null,
  characters: [
    { id: "char1", name: "", description: "", images: [], isDefault: true },
    { id: "char2", name: "", description: "", images: [], isDefault: false },
    { id: "char3", name: "", description: "", images: [], isDefault: false },
  ],
  scenes: [],
  stylePrompt: "",
  usageStats: {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCost: 0
  },
  usageHistory: []
};

export function slugify(text: string): string {
  return text
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d")
    .replace(/([^0-9a-z-\s])/g, "")
    .replace(/(\s+)/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}
