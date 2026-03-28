/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  Save, 
  FolderOpen, 
  RotateCcw, 
  RotateCw, 
  Key, 
  Coffee, 
  X, 
  Maximize2, 
  RefreshCw, 
  Download,
  ExternalLink,
  ChevronRight,
  Plus,
  Star,
  Trash2,
  Image as ImageIcon,
  Upload,
  ChevronLeft,
  Loader2,
  HelpCircle,
  Zap,
  TrendingUp,
  TrendingDown
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI } from "@google/genai";
import JSZip from 'jszip';
import { ProjectState, TabData, HistoryState, DEFAULT_PROJECT_STATE, slugify, Character, Scene, UsageEvent } from './types';

export default function App() {
  // State
  const [state, setState] = useState<ProjectState>(DEFAULT_PROJECT_STATE);
  const [history, setHistory] = useState<HistoryState>({
    past: [],
    present: DEFAULT_PROJECT_STATE,
    future: []
  });
  const [zoom, setZoom] = useState(1);
  const [isSticky, setIsSticky] = useState(false);
  const [showApiKeyModal, setShowApiKeyModal] = useState(false);
  const [showCoffeeModal, setShowCoffeeModal] = useState(false);
  const [showCharSelectModal, setShowCharSelectModal] = useState<{ sceneId: string } | null>(null);
  const [fullViewSceneIndex, setFullViewSceneIndex] = useState<number | null>(null);
  const [tempApiKey, setTempApiKey] = useState("");
  const [isGeneratingAll, setIsGeneratingAll] = useState(false);
  const [lastEstimation, setLastEstimation] = useState<{
    model: string;
    inputTokens: number;
    outputTokens: number;
    cost: number;
  } | null>(null);
  const [showEstimationToast, setShowEstimationToast] = useState(false);
  
  const containerRef = useRef<HTMLDivElement>(null);

  // Undo/Redo Logic
  const canUndo = history.past.length > 0;
  const canRedo = history.future.length > 0;

  const updateState = useCallback((newState: ProjectState, saveToHistory = true) => {
    setState(newState);
    if (saveToHistory) {
      setHistory(prev => ({
        past: [...prev.past, prev.present],
        present: newState,
        future: []
      }));
    }
  }, []);

  const undo = useCallback(() => {
    if (!canUndo) return;
    const previous = history.past[history.past.length - 1];
    const newPast = history.past.slice(0, history.past.length - 1);
    
    setHistory({
      past: newPast,
      present: previous,
      future: [history.present, ...history.future]
    });
    setState(previous);
  }, [canUndo, history]);

  const redo = useCallback(() => {
    if (!canRedo) return;
    const next = history.future[0];
    const newFuture = history.future.slice(1);
    
    setHistory({
      past: [...history.past, history.present],
      present: next,
      future: newFuture
    });
    setState(next);
  }, [canRedo, history]);

  // File Operations
  const handleSave = useCallback(async () => {
    const fileName = state.projectName ? `${slugify(state.projectName)}.json` : 'du-an-moi.json';
    const dataStr = JSON.stringify(state, null, 2);
    
    try {
      if ('showSaveFilePicker' in window) {
        const handle = await (window as any).showSaveFilePicker({
          suggestedName: fileName,
          types: [{
            description: 'JSON Files',
            accept: { 'application/json': ['.json'] },
          }],
        });
        const writable = await handle.createWritable();
        await writable.write(dataStr);
        await writable.close();
      } else {
        const blob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        link.click();
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      console.error('Save failed:', err);
    }
  }, [state]);

  const handleOpen = useCallback(async () => {
    try {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json';
      input.onchange = async (e: any) => {
        const file = e.target.files[0];
        if (!file) return;
        const text = await file.text();
        const loadedState = JSON.parse(text);
        updateState(loadedState);
      };
      input.click();
    } catch (err) {
      console.error('Open failed:', err);
    }
  }, [updateState]);

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        switch (e.key.toLowerCase()) {
          case 's':
            e.preventDefault();
            handleSave();
            break;
          case 'o':
            e.preventDefault();
            handleOpen();
            break;
          case 'z':
            e.preventDefault();
            if (e.shiftKey) redo();
            else undo();
            break;
          case 'y':
            e.preventDefault();
            redo();
            break;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSave, handleOpen, undo, redo]);

  // Zoom Logic
  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -0.1 : 0.1;
        setZoom(prev => Math.min(Math.max(prev + delta, 0.5), 3));
      }
    };

    window.addEventListener('wheel', handleWheel, { passive: false });
    return () => window.removeEventListener('wheel', handleWheel);
  }, []);

  // Scroll Logic for Sticky Header
  useEffect(() => {
    const handleScroll = () => {
      setIsSticky(window.scrollY > 50);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const handleTabChange = (tabId: string) => {
    updateState({ ...state, activeTabId: tabId });
  };

  const handleProjectNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    updateState({ ...state, projectName: e.target.value.toUpperCase() });
  };

  // Character Management
  const updateCharacter = (id: string, updates: Partial<Character>) => {
    const newCharacters = state.characters.map(char => {
      if (char.id === id) {
        const updatedChar = { ...char, ...updates };
        if (updates.isDefault) {
          // Unset others
          return { ...updatedChar, isDefault: true };
        }
        return updatedChar;
      }
      if (updates.isDefault) return { ...char, isDefault: false };
      return char;
    });
    updateState({ ...state, characters: newCharacters });
  };

  const handleImageUpload = (charId: string, files: FileList | null) => {
    if (!files) return;
    const char = state.characters.find(c => c.id === charId);
    if (!char) return;

    const remainingSlots = 5 - char.images.length;
    const filesToProcess = Array.from(files).slice(0, remainingSlots);

    filesToProcess.forEach(file => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const base64 = e.target?.result as string;
        updateCharacter(charId, { images: [...char.images, base64].slice(0, 5) });
      };
      reader.readAsDataURL(file);
    });
  };

  // Scene Management
  const addScene = () => {
    const newScene: Scene = {
      id: Math.random().toString(36).substr(2, 9),
      sceneCode: (state.scenes.length + 1).toString(),
      lang1: "",
      vietnamese: "",
      promptName: "",
      description: "",
      characterIds: [],
      generatedImage: null,
      isGenerating: false
    };
    updateState({ ...state, scenes: [...state.scenes, newScene] });
  };

  const handleExcelUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      const bstr = evt.target?.result;
      const wb = XLSX.read(bstr, { type: 'binary' });
      const wsname = wb.SheetNames[0];
      const ws = wb.Sheets[wsname];
      const data = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][];

      // Skip header row
      const rows = data.slice(1);
      
      const defaultChar = state.characters.find(c => c.isDefault);

      const newScenes: Scene[] = rows.map((row) => {
        const sceneCode = String(row[0] || "");
        const lang1 = String(row[1] || "");
        const vietnamese = String(row[2] || "");
        const promptName = String(row[3] || "");
        const description = String(row[4] || "");

        let characterIds: string[] = [];
        if (sceneCode.toUpperCase().includes('C')) {
          characterIds = defaultChar ? [defaultChar.id] : [];
        }

        return {
          id: Math.random().toString(36).substr(2, 9),
          sceneCode,
          lang1,
          vietnamese,
          promptName,
          description,
          characterIds,
          generatedImage: null,
          isGenerating: false
        };
      });

      updateState({ ...state, scenes: [...state.scenes, ...newScenes] });
    };
    reader.readAsBinaryString(file);
    // Reset input
    e.target.value = '';
  };

  const updateScene = (id: string, updates: Partial<Scene>) => {
    const newScenes = state.scenes.map(s => s.id === id ? { ...s, ...updates } : s);
    updateState({ ...state, scenes: newScenes });
  };

  // Cost Calculation Utilities
  const PRICING = {
    text: { input: 0.30 / 1_000_000, output: 2.50 / 1_000_000 },
    image: { input: 0.30 / 1_000_000, output: 2.50 / 1_000_000 }, // Assuming similar for now
    audio: { input: 1.00 / 1_000_000 }
  };

  const estimateTokens = (text: string, mediaCount: number = 0) => {
    // Rough estimation: 1 token ~= 4 characters for English, more for Vietnamese
    const textTokens = Math.ceil(text.length / 3); 
    const mediaTokens = mediaCount * 258; // Standard for Gemini image input
    return textTokens + mediaTokens;
  };

  const calculateCost = (inputTokens: number, outputTokens: number, type: 'text' | 'image' = 'text') => {
    const inputCost = inputTokens * PRICING[type].input;
    const outputCost = outputTokens * PRICING[type].output;
    return inputCost + outputCost;
  };

  const trackUsage = (event: Omit<UsageEvent, 'id' | 'timestamp'>) => {
    const newEvent: UsageEvent = {
      ...event,
      id: Math.random().toString(36).substr(2, 9),
      timestamp: Date.now()
    };

    updateState({
      ...state,
      usageStats: {
        totalInputTokens: state.usageStats.totalInputTokens + event.inputTokens,
        totalOutputTokens: state.usageStats.totalOutputTokens + event.outputTokens,
        totalCost: state.usageStats.totalCost + event.actualCost
      },
      usageHistory: [newEvent, ...state.usageHistory]
    });
  };

  // Image Generation
  const generateImage = async (sceneId: string, customPrompt?: string) => {
    const sceneIndex = state.scenes.findIndex(s => s.id === sceneId);
    if (sceneIndex === -1) return;
    const scene = state.scenes[sceneIndex];

    const apiKey = state.apiKey || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      setShowApiKeyModal(true);
      return;
    }

    // Estimate Cost
    const promptText = `Generate a high-quality illustration for a scene. Scene Context: ${scene.promptName} Background Description: ${customPrompt || scene.description} Overall Style: ${state.stylePrompt || "Realistic, cinematic lighting, high detail"}`;
    const selectedChars = state.characters.filter(c => scene.characterIds.includes(c.id));
    const mediaCount = selectedChars.reduce((acc, char) => acc + char.images.length, 0);
    const estimatedInputTokens = estimateTokens(promptText, mediaCount);
    const estimatedOutputTokens = 1024; // Fixed for image generation usually
    const estimatedCost = calculateCost(estimatedInputTokens, estimatedOutputTokens, 'image');

    setLastEstimation({
      model: "gemini-2.5-flash-image",
      inputTokens: estimatedInputTokens,
      outputTokens: estimatedOutputTokens,
      cost: estimatedCost
    });
    setShowEstimationToast(true);
    setTimeout(() => setShowEstimationToast(false), 5000);

    updateScene(sceneId, { isGenerating: true });

    try {
      const ai = new GoogleGenAI({ apiKey });
      const model = "gemini-2.5-flash-image";
      
      // Context from adjacent scenes for background consistency
      const prevScene = sceneIndex > 0 ? state.scenes[sceneIndex - 1] : null;
      const nextScene = sceneIndex < state.scenes.length - 1 ? state.scenes[sceneIndex + 1] : null;

      const promptParts: string[] = [
        "Generate a high-quality illustration for a scene.",
        `Scene Context: ${scene.promptName}`,
        `Background Description: ${customPrompt || scene.description}`,
        `Overall Style: ${state.stylePrompt || "Realistic, cinematic lighting, high detail"}`,
      ];

      if (prevScene) {
        promptParts.push(`Previous Scene Context (for background consistency): ${prevScene.description}`);
      }
      if (nextScene) {
        promptParts.push(`Next Scene Context (for background consistency): ${nextScene.description}`);
      }

      promptParts.push("MANDATORY: Do not include any text, letters, or numbers in the image.");
      promptParts.push("MANDATORY: Ensure character visual consistency based on the provided reference images and descriptions if characters are present.");
      promptParts.push("MANDATORY: Maintain background and environmental consistency with adjacent scenes if the context is similar.");

      const parts: any[] = [
        { text: promptParts.join("\n") }
      ];

      selectedChars.forEach(char => {
        parts.push({ text: `CHARACTER REFERENCE [${char.name}]: ${char.description}` });
        char.images.forEach(img => {
          const [header, data] = img.split(',');
          const mimeType = header.split(':')[1].split(';')[0];
          parts.push({
            inlineData: {
              mimeType,
              data
            }
          });
        });
      });

      const response = await ai.models.generateContent({
        model,
        contents: { parts }
      });

      let generatedImage = null;
      for (const part of response.candidates[0].content.parts) {
        if (part.inlineData) {
          generatedImage = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
          break;
        }
      }

      // Track usage
      const actualInputTokens = response.usageMetadata?.promptTokenCount || estimatedInputTokens;
      const actualOutputTokens = response.usageMetadata?.candidatesTokenCount || estimatedOutputTokens;
      const actualCost = calculateCost(actualInputTokens, actualOutputTokens, 'image');
      const diffPercent = ((actualCost - estimatedCost) / estimatedCost) * 100;

      trackUsage({
        model: "gemini-2.5-flash-image",
        type: 'image',
        inputTokens: actualInputTokens,
        outputTokens: actualOutputTokens,
        estimatedCost,
        actualCost,
        diffPercent
      });

      if (generatedImage) {
        updateScene(sceneId, { generatedImage, isGenerating: false });
      } else {
        throw new Error("No image generated");
      }
    } catch (err) {
      console.error("Generation failed:", err);
      updateScene(sceneId, { isGenerating: false });
    }
  };

  const generateScriptSuggestion = async () => {
    const apiKey = state.apiKey || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      setShowApiKeyModal(true);
      return;
    }

    const promptText = `Dựa trên các nhân vật hiện có: ${state.characters.map(c => c.name).join(", ")}, hãy gợi ý thêm 3-5 phân cảnh mới cho kịch bản. Trả về kết quả dưới dạng JSON array với các trường: sceneCode, lang1, vietnamese, promptName, description.`;
    const estimatedInputTokens = estimateTokens(promptText);
    const estimatedOutputTokens = 500;
    const estimatedCost = calculateCost(estimatedInputTokens, estimatedOutputTokens, 'text');

    setLastEstimation({
      model: "gemini-2.5-flash",
      inputTokens: estimatedInputTokens,
      outputTokens: estimatedOutputTokens,
      cost: estimatedCost
    });
    setShowEstimationToast(true);
    setTimeout(() => setShowEstimationToast(false), 5000);

    try {
      const ai = new GoogleGenAI({ apiKey });
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{ text: promptText }],
        config: { responseMimeType: "application/json" }
      });

      const result = JSON.parse(response.text);
      if (Array.isArray(result)) {
        const newScenes: Scene[] = result.map((s: any) => ({
          id: Math.random().toString(36).substr(2, 9),
          sceneCode: s.sceneCode || `SC-${state.scenes.length + 1}`,
          lang1: s.lang1 || "",
          vietnamese: s.vietnamese || "",
          promptName: s.promptName || "",
          description: s.description || "",
          characterIds: [],
          generatedImage: null,
          isGenerating: false
        }));

        // Track usage
        const actualInputTokens = response.usageMetadata?.promptTokenCount || estimatedInputTokens;
        const actualOutputTokens = response.usageMetadata?.candidatesTokenCount || estimatedOutputTokens;
        const actualCost = calculateCost(actualInputTokens, actualOutputTokens, 'text');
        const diffPercent = ((actualCost - estimatedCost) / estimatedCost) * 100;

        trackUsage({
          model: "gemini-2.5-flash",
          type: 'text',
          inputTokens: actualInputTokens,
          outputTokens: actualOutputTokens,
          estimatedCost,
          actualCost,
          diffPercent
        });

        updateState({ ...state, scenes: [...state.scenes, ...newScenes] });
      }
    } catch (err) {
      console.error("Script suggestion failed:", err);
    }
  };

  const generateAllImages = async () => {
    setIsGeneratingAll(true);
    for (const scene of state.scenes) {
      if (!scene.generatedImage) {
        await generateImage(scene.id);
      }
    }
    setIsGeneratingAll(false);
  };

  const downloadAllAsZip = async () => {
    const zip = new JSZip();
    state.scenes.forEach((scene, index) => {
      if (scene.generatedImage) {
        const base64Data = scene.generatedImage.split(',')[1];
        const fileName = `${scene.sceneCode || index + 1}.png`;
        zip.file(fileName, base64Data, { base64: true });
      }
    });
    const content = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(content);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${slugify(state.projectName || 'project')}-images.zip`;
    link.click();
  };

  return (
    <div className="min-h-screen flex flex-col font-sans">
      {/* Header */}
      <header 
        className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
          isSticky ? 'glass-panel py-2' : 'bg-transparent py-4'
        }`}
      >
        <div className="max-w-7xl mx-auto px-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold gradient-text">Xizital App Studio</h1>
          
          <div className="flex items-center gap-3">
            <button 
              onClick={handleOpen}
              className="p-2 rounded-lg hover:bg-green-50 text-green-600 transition-colors flex items-center gap-2 text-sm font-medium"
              title="Mở dự án (Ctrl+O)"
            >
              <FolderOpen size={18} />
              <span className="hidden sm:inline">Mở</span>
            </button>
            <button 
              onClick={handleSave}
              className="p-2 rounded-lg bg-green-600 text-white hover:bg-green-700 transition-colors flex items-center gap-2 text-sm font-medium shadow-md"
              title="Lưu dự án (Ctrl+S)"
            >
              <Save size={18} />
              <span className="hidden sm:inline">Lưu</span>
            </button>
            <div className="h-6 w-[1px] bg-neutral-200 mx-2" />
            <button 
              onClick={undo}
              disabled={!canUndo}
              className="p-2 rounded-lg hover:bg-neutral-100 disabled:opacity-30 text-neutral-600"
              title="Hoàn tác (Ctrl+Z)"
            >
              <RotateCcw size={18} />
            </button>
            <button 
              onClick={redo}
              disabled={!canRedo}
              className="p-2 rounded-lg hover:bg-neutral-100 disabled:opacity-30 text-neutral-600"
              title="Làm lại (Ctrl+Shift+Z)"
            >
              <RotateCw size={18} />
            </button>
            <button 
              onClick={() => setShowApiKeyModal(true)}
              className="p-2 rounded-lg hover:bg-neutral-100 text-neutral-600"
              title="Quản lý API Key"
            >
              <Key size={18} />
            </button>
          </div>
        </div>
      </header>

      {/* Zoom Reset Indicator */}
      {zoom !== 1 && (
        <div className="fixed top-20 right-6 z-40">
          <button 
            onClick={() => setZoom(1)}
            className="glass-panel px-4 py-2 rounded-full text-xs font-bold text-green-600 flex items-center gap-2 hover:bg-green-50 transition-all"
          >
            <RefreshCw size={14} />
            {Math.round(zoom * 100)}% - Reset
          </button>
        </div>
      )}

      {/* Main Content with Zoom */}
      <main 
        className="flex-grow pt-32 pb-20 px-6 transition-transform duration-200 origin-top"
        style={{ transform: `scale(${zoom})` }}
      >
        <div className="max-w-6xl mx-auto flex flex-col items-center gap-12">
          {/* Project Name Input */}
          <div className="relative w-full max-w-2xl group">
            <input
              type="text"
              value={state.projectName}
              onChange={handleProjectNameChange}
              placeholder="NHẬP TÊN DỰ ÁN TẠI ĐÂY"
              className={`w-full text-center text-4xl font-black py-4 bg-transparent border-b-2 border-neutral-200 focus:border-green-500 outline-none transition-all ${
                state.projectName ? 'gradient-text' : 'text-neutral-300'
              }`}
            />
          </div>

          {/* Tabs Section */}
          <div className="w-full space-y-6">
            <div className="flex gap-2 border-b border-neutral-200">
              {state.tabs.map(tab => (
                <button
                  key={tab.id}
                  onClick={() => handleTabChange(tab.id)}
                  className={`px-6 py-3 text-sm font-bold transition-all relative ${
                    state.activeTabId === tab.id 
                    ? 'text-green-600' 
                    : 'text-neutral-400 hover:text-neutral-600'
                  }`}
                >
                  {tab.title}
                  {state.activeTabId === tab.id && (
                    <motion.div 
                      layoutId="activeTab"
                      className="absolute bottom-0 left-0 right-0 h-1 bg-green-500 rounded-t-full"
                    />
                  )}
                </button>
              ))}
            </div>
            
            <div className="min-h-[500px] glass-panel p-8 rounded-2xl">
              <AnimatePresence mode="wait">
                {state.activeTabId === 'tab1' && (
                  <motion.div
                    key="characters"
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    className="grid grid-cols-1 md:grid-cols-3 gap-6"
                  >
                    {state.characters.map((char) => (
                      <div key={char.id} className="glass-panel p-6 rounded-2xl space-y-4 relative group">
                        <button 
                          onClick={() => updateCharacter(char.id, { isDefault: true })}
                          className={`absolute top-4 right-4 p-2 rounded-full transition-colors ${
                            char.isDefault ? 'text-yellow-500 bg-yellow-50' : 'text-neutral-300 hover:text-yellow-500 hover:bg-yellow-50'
                          }`}
                          title="Đặt làm nhân vật mặc định"
                        >
                          <Star size={20} fill={char.isDefault ? "currentColor" : "none"} />
                        </button>

                        <div 
                          className="aspect-square w-full rounded-xl bg-neutral-100 border-2 border-dashed border-neutral-200 flex flex-col items-center justify-center gap-2 overflow-hidden relative group/upload"
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={(e) => {
                            e.preventDefault();
                            handleImageUpload(char.id, e.dataTransfer.files);
                          }}
                        >
                          {char.images.length > 0 ? (
                            <div className="grid grid-cols-2 gap-1 w-full h-full p-1">
                              {char.images.map((img, idx) => (
                                <div key={idx} className="relative group/img aspect-square">
                                  <img src={img} className="w-full h-full object-cover rounded-lg" />
                                  <button 
                                    onClick={() => updateCharacter(char.id, { images: char.images.filter((_, i) => i !== idx) })}
                                    className="absolute top-1 right-1 p-1 bg-red-500 text-white rounded-full opacity-0 group-hover/img:opacity-100 transition-opacity"
                                  >
                                    <X size={12} />
                                  </button>
                                </div>
                              ))}
                              {char.images.length < 5 && (
                                <label className="flex items-center justify-center bg-neutral-200/50 rounded-lg cursor-pointer hover:bg-neutral-200 transition-colors">
                                  <Plus size={20} className="text-neutral-500" />
                                  <input type="file" multiple className="hidden" onChange={(e) => handleImageUpload(char.id, e.target.files)} />
                                </label>
                              )}
                            </div>
                          ) : (
                            <label className="flex flex-col items-center cursor-pointer">
                              <Upload size={32} className="text-neutral-400" />
                              <span className="text-xs font-bold text-neutral-400 mt-2">Kéo ảnh hoặc Click</span>
                              <input type="file" multiple className="hidden" onChange={(e) => handleImageUpload(char.id, e.target.files)} />
                            </label>
                          )}
                        </div>

                        <div className="space-y-3">
                          <input 
                            type="text" 
                            placeholder="Tên nhân vật..."
                            value={char.name}
                            onChange={(e) => updateCharacter(char.id, { name: e.target.value })}
                            className="w-full px-3 py-2 rounded-lg bg-neutral-50 border border-neutral-200 focus:border-green-500 outline-none text-sm font-bold"
                          />
                          <textarea 
                            placeholder="Mô tả đặc điểm đồng nhất..."
                            value={char.description}
                            onChange={(e) => updateCharacter(char.id, { description: e.target.value })}
                            className="w-full h-24 px-3 py-2 rounded-lg bg-neutral-50 border border-neutral-200 focus:border-green-500 outline-none text-xs resize-none"
                          />
                        </div>
                      </div>
                    ))}
                  </motion.div>
                )}

                {state.activeTabId === 'tab2' && (
                  <motion.div
                    key="script"
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    className="space-y-8"
                  >
                    {/* Style Prompt Field */}
                    <div className="glass-panel p-6 rounded-2xl space-y-3">
                      <div className="flex items-center gap-2 text-green-600">
                        <Star size={18} />
                        <h4 className="text-sm font-bold uppercase tracking-widest">Mô tả phong cách chung (Style Prompt)</h4>
                      </div>
                      <textarea 
                        value={state.stylePrompt}
                        onChange={(e) => updateState({ ...state, stylePrompt: e.target.value })}
                        placeholder="Ví dụ: Phong cách hoạt hình 3D, ánh sáng điện ảnh, màu sắc rực rỡ..."
                        className="w-full h-20 px-4 py-3 rounded-xl bg-neutral-50 border border-neutral-200 focus:border-green-500 outline-none text-sm resize-none"
                      />
                    </div>

                    <div className="flex justify-between items-center">
                      <div className="flex gap-3">
                        <button 
                          onClick={generateScriptSuggestion}
                          className="px-4 py-2 rounded-xl bg-green-50 text-green-600 font-bold text-sm flex items-center gap-2 hover:bg-green-100 transition-colors"
                        >
                          <Zap size={18} /> Gợi ý kịch bản AI
                        </button>
                        <button 
                          onClick={addScene}
                          className="btn-gradient-hover px-4 py-2 rounded-xl bg-green-600 text-white font-bold text-sm flex items-center gap-2 shadow-md"
                        >
                          <Plus size={18} /> Thêm Phân đoạn
                        </button>
                        <label className="px-4 py-2 rounded-xl bg-neutral-100 text-neutral-600 font-bold text-sm flex items-center gap-2 hover:bg-neutral-200 cursor-pointer transition-colors">
                          <Upload size={18} /> Upload Excel
                          <input type="file" accept=".xlsx, .xls" className="hidden" onChange={handleExcelUpload} />
                        </label>
                        <button 
                          onClick={generateAllImages}
                          disabled={isGeneratingAll || state.scenes.length === 0}
                          className="px-4 py-2 rounded-xl bg-neutral-100 text-neutral-600 font-bold text-sm flex items-center gap-2 hover:bg-neutral-200 disabled:opacity-50 transition-colors"
                        >
                          {isGeneratingAll ? <Loader2 size={18} className="animate-spin" /> : <ImageIcon size={18} />}
                          Tạo ảnh hàng loạt
                        </button>
                      </div>
                      <button 
                        onClick={downloadAllAsZip}
                        disabled={state.scenes.every(s => !s.generatedImage)}
                        className="px-4 py-2 rounded-xl bg-neutral-100 text-neutral-600 font-bold text-sm flex items-center gap-2 hover:bg-neutral-200 disabled:opacity-50 transition-colors"
                      >
                        <Download size={18} /> Tải xuống Full (ZIP)
                      </button>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full border-collapse">
                        <thead>
                          <tr className="text-left text-xs font-bold text-neutral-400 uppercase tracking-widest border-b border-neutral-100">
                            <th className="py-4 px-4 w-24 text-center">
                              <div className="flex items-center justify-center gap-1">
                                Scene
                                <div className="group relative inline-block">
                                  <HelpCircle size={14} className="cursor-help text-neutral-300" />
                                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 p-2 bg-neutral-800 text-white text-[10px] rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 normal-case font-normal">
                                    Số thứ tự phân cảnh. Khi tải các file ảnh được tạo ra từ phân cảnh này, ảnh sẽ được đặt tên giống tên của ô trong cột này.
                                  </div>
                                </div>
                              </div>
                            </th>
                            <th className="py-4 px-4">Ngôn ngữ 1</th>
                            <th className="py-4 px-4">Tiếng Việt</th>
                            <th className="py-4 px-4">
                              <div className="flex items-center gap-1">
                                Tên Prompt
                                <div className="group relative inline-block">
                                  <HelpCircle size={14} className="cursor-help text-neutral-300" />
                                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 p-2 bg-neutral-800 text-white text-[10px] rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 normal-case font-normal">
                                    Tóm tắt những gì xảy ra trong phân cảnh này để check tính chính xác của ảnh tạo ra.
                                  </div>
                                </div>
                              </div>
                            </th>
                            <th className="py-4 px-4">Mô tả bối cảnh</th>
                            <th className="py-4 px-4 w-40">Nhân vật</th>
                            <th className="py-4 px-4 w-48 text-center">Ảnh minh họa</th>
                          </tr>
                        </thead>
                        <tbody>
                          {state.scenes.map((scene, idx) => (
                            <tr key={scene.id} className="border-b border-neutral-50 hover:bg-neutral-50/50 transition-colors group">
                              <td className="py-6 px-4 text-center font-bold text-neutral-400 align-middle">
                                <input 
                                  value={scene.sceneCode}
                                  onChange={(e) => updateScene(scene.id, { sceneCode: e.target.value })}
                                  className="w-full bg-transparent text-center outline-none focus:text-green-600 transition-colors"
                                />
                              </td>
                              <td className="py-6 px-4 align-middle">
                                <textarea 
                                  value={scene.lang1}
                                  onChange={(e) => updateScene(scene.id, { lang1: e.target.value })}
                                  className="w-full bg-transparent outline-none text-sm resize-none min-h-[60px] focus:text-neutral-900 transition-colors"
                                  placeholder="Nội dung..."
                                />
                              </td>
                              <td className="py-6 px-4 align-middle">
                                <textarea 
                                  value={scene.vietnamese}
                                  onChange={(e) => updateScene(scene.id, { vietnamese: e.target.value })}
                                  className="w-full bg-transparent outline-none text-sm resize-none min-h-[60px] focus:text-neutral-900 transition-colors"
                                  placeholder="Nội dung..."
                                />
                              </td>
                              <td className="py-6 px-4 align-middle">
                                <textarea 
                                  value={scene.promptName}
                                  onChange={(e) => updateScene(scene.id, { promptName: e.target.value })}
                                  className="w-full bg-transparent outline-none text-sm font-medium resize-none min-h-[60px] focus:text-neutral-900 transition-colors"
                                  placeholder="Tóm tắt..."
                                />
                              </td>
                              <td className="py-6 px-4 align-middle">
                                <textarea 
                                  value={scene.description}
                                  onChange={(e) => updateScene(scene.id, { description: e.target.value })}
                                  className="w-full bg-transparent outline-none text-sm text-neutral-600 italic resize-none min-h-[60px] focus:text-neutral-900 transition-colors"
                                  placeholder="Mô tả bối cảnh..."
                                />
                              </td>
                              <td className="py-6 px-4 align-middle">
                                <button 
                                  onClick={() => setShowCharSelectModal({ sceneId: scene.id })}
                                  className="w-full px-3 py-2 rounded-lg bg-white border border-neutral-200 text-xs font-bold text-neutral-600 hover:border-green-500 transition-all flex items-center justify-between shadow-sm"
                                >
                                  <span className="truncate">
                                    {scene.characterIds.length > 0 
                                      ? state.characters.filter(c => scene.characterIds.includes(c.id)).map(c => c.name || "Chưa đặt tên").join(", ")
                                      : "None"}
                                  </span>
                                  <ChevronRight size={14} className="text-neutral-400" />
                                </button>
                              </td>
                              <td className="py-6 px-4 align-middle">
                                <div className="flex flex-col items-center gap-2">
                                  {scene.generatedImage ? (
                                    <div className="relative group/img w-32 aspect-video rounded-lg overflow-hidden border border-neutral-200 shadow-sm bg-neutral-100">
                                      <img src={scene.generatedImage} className="w-full h-full object-cover" />
                                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/img:opacity-100 transition-opacity flex items-center justify-center gap-2">
                                        <button 
                                          onClick={() => setFullViewSceneIndex(idx)}
                                          className="p-2 bg-white text-neutral-800 rounded-full hover:scale-110 transition-transform shadow-lg"
                                        >
                                          <Maximize2 size={14} />
                                        </button>
                                        <button 
                                          onClick={() => generateImage(scene.id)}
                                          className="p-2 bg-white text-neutral-800 rounded-full hover:scale-110 transition-transform shadow-lg"
                                        >
                                          <RefreshCw size={14} />
                                        </button>
                                      </div>
                                    </div>
                                  ) : (
                                    <button 
                                      onClick={() => generateImage(scene.id)}
                                      disabled={scene.isGenerating}
                                      className="w-32 aspect-video rounded-lg bg-neutral-100 border-2 border-dashed border-neutral-200 flex flex-col items-center justify-center gap-1 text-neutral-400 hover:border-green-500 hover:text-green-500 transition-all group/gen"
                                    >
                                      {scene.isGenerating ? (
                                        <Loader2 size={24} className="animate-spin text-green-500" />
                                      ) : (
                                        <>
                                          <ImageIcon size={20} className="group-hover/gen:scale-110 transition-transform" />
                                          <span className="text-[10px] font-bold">Tạo ảnh</span>
                                        </>
                                      )}
                                    </button>
                                  )}
                                  <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button 
                                      onClick={() => {
                                        const link = document.createElement('a');
                                        link.href = scene.generatedImage!;
                                        link.download = `${scene.sceneCode || idx + 1}.png`;
                                        link.click();
                                      }}
                                      disabled={!scene.generatedImage}
                                      className="text-[10px] font-bold text-neutral-400 hover:text-green-600 flex items-center gap-1 transition-colors"
                                    >
                                      <Download size={12} /> Tải về
                                    </button>
                                    <button 
                                      onClick={() => updateState({ ...state, scenes: state.scenes.filter(s => s.id !== scene.id) })}
                                      className="text-[10px] font-bold text-neutral-400 hover:text-red-600 flex items-center gap-1 transition-colors"
                                    >
                                      <Trash2 size={12} /> Xóa
                                    </button>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* Prompt App Link */}
                    <div className="glass-panel p-8 rounded-3xl border-l-4 border-l-green-500 flex flex-col md:flex-row items-center justify-between gap-6">
                      <div className="text-left space-y-2">
                        <h4 className="font-bold text-lg">Hướng dẫn bổ sung chức năng</h4>
                        <p className="text-neutral-600 text-sm">
                          Quay trở lại trang Prompt App của Xizital để khám phá thêm nhiều công cụ hữu ích khác.
                        </p>
                      </div>
                      <a 
                        href="https://xizital.com/prompt-tao-app-bang-google-ai-studio/" 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="btn-gradient-hover px-6 py-3 rounded-xl bg-neutral-100 font-bold text-sm flex items-center gap-2"
                      >
                        Prompt App <ChevronRight size={16} />
                      </a>
                    </div>
                  </motion.div>
                )}

                {state.activeTabId === 'tab3' && (
                  <motion.div
                    key="usage"
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="space-y-8"
                  >
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      <div className="glass-panel p-6 rounded-2xl bg-white/40">
                        <div className="flex items-center gap-3 text-neutral-500 mb-2">
                          <Zap size={20} />
                          <span className="text-xs font-black uppercase tracking-widest">Tổng Input Tokens</span>
                        </div>
                        <div className="text-3xl font-black text-neutral-800">
                          {state.usageStats.totalInputTokens.toLocaleString()}
                        </div>
                      </div>
                      <div className="glass-panel p-6 rounded-2xl bg-white/40">
                        <div className="flex items-center gap-3 text-neutral-500 mb-2">
                          <Zap size={20} className="rotate-180" />
                          <span className="text-xs font-black uppercase tracking-widest">Tổng Output Tokens</span>
                        </div>
                        <div className="text-3xl font-black text-neutral-800">
                          {state.usageStats.totalOutputTokens.toLocaleString()}
                        </div>
                      </div>
                      <div className="glass-panel p-6 rounded-2xl bg-green-50/50 border-green-100">
                        <div className="flex items-center gap-3 text-green-600 mb-2">
                          <TrendingUp size={20} />
                          <span className="text-xs font-black uppercase tracking-widest">Tổng Chi Phí (USD)</span>
                        </div>
                        <div className="text-3xl font-black text-green-700">
                          ${state.usageStats.totalCost.toFixed(6)}
                        </div>
                      </div>
                    </div>

                    <div className="glass-panel rounded-2xl overflow-hidden">
                      <div className="p-6 border-b border-neutral-100 flex justify-between items-center">
                        <h4 className="text-sm font-black uppercase tracking-widest text-neutral-800">Lịch sử sử dụng</h4>
                        <button 
                          onClick={() => updateState({ ...state, usageHistory: [], usageStats: { totalInputTokens: 0, totalOutputTokens: 0, totalCost: 0 } })}
                          className="text-xs font-bold text-red-500 hover:underline"
                        >
                          Xóa lịch sử
                        </button>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="bg-neutral-50/50">
                              <th className="py-3 px-6 text-[10px] font-black uppercase tracking-widest text-neutral-400">Thời gian</th>
                              <th className="py-3 px-6 text-[10px] font-black uppercase tracking-widest text-neutral-400">Model</th>
                              <th className="py-3 px-6 text-[10px] font-black uppercase tracking-widest text-neutral-400">Tokens (I/O)</th>
                              <th className="py-3 px-6 text-[10px] font-black uppercase tracking-widest text-neutral-400">Dự kiến</th>
                              <th className="py-3 px-6 text-[10px] font-black uppercase tracking-widest text-neutral-400">Thực tế</th>
                              <th className="py-3 px-6 text-[10px] font-black uppercase tracking-widest text-neutral-400">Chênh lệch</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-neutral-50">
                            {state.usageHistory.map((event) => (
                              <tr key={event.id} className="text-xs">
                                <td className="py-3 px-6 text-neutral-500">
                                  {new Date(event.timestamp).toLocaleString()}
                                </td>
                                <td className="py-3 px-6 font-bold text-neutral-700">
                                  {event.model}
                                </td>
                                <td className="py-3 px-6 text-neutral-600">
                                  {event.inputTokens.toLocaleString()} / {event.outputTokens.toLocaleString()}
                                </td>
                                <td className="py-3 px-6 text-neutral-600">
                                  ${event.estimatedCost.toFixed(6)}
                                </td>
                                <td className="py-3 px-6 font-bold text-neutral-800">
                                  ${event.actualCost.toFixed(6)}
                                </td>
                                <td className="py-3 px-6">
                                  <div className={`flex items-center gap-1 font-bold ${event.diffPercent > 0 ? 'text-red-500' : 'text-green-500'}`}>
                                    {event.diffPercent > 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                                    {Math.abs(event.diffPercent).toFixed(1)}%
                                  </div>
                                </td>
                              </tr>
                            ))}
                            {state.usageHistory.length === 0 && (
                              <tr>
                                <td colSpan={6} className="py-12 text-center text-neutral-400 font-bold italic">
                                  Chưa có dữ liệu sử dụng
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
        {/* Estimation Toast */}
        <AnimatePresence>
          {showEstimationToast && lastEstimation && (
            <motion.div
              initial={{ opacity: 0, y: 50, x: '-50%' }}
              animate={{ opacity: 1, y: 0, x: '-50%' }}
              exit={{ opacity: 0, y: 50, x: '-50%' }}
              className="fixed bottom-8 left-1/2 z-[100] glass-panel p-4 rounded-2xl shadow-2xl border-green-200 bg-white/90 min-w-[300px]"
            >
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center text-green-600">
                  <Zap size={20} />
                </div>
                <div>
                  <h5 className="text-[10px] font-black uppercase tracking-widest text-neutral-400">Ước tính chi phí AI</h5>
                  <div className="flex items-baseline gap-2">
                    <span className="text-lg font-black text-neutral-800">${lastEstimation.cost.toFixed(6)}</span>
                    <span className="text-[10px] font-bold text-neutral-500">({lastEstimation.model})</span>
                  </div>
                  <p className="text-[9px] text-neutral-400 font-bold">
                    Input: {lastEstimation.inputTokens} tokens | Output: {lastEstimation.outputTokens} tokens
                  </p>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Footer */}
      <footer className="py-8 text-center border-t border-neutral-100">
        <p className="text-neutral-400 text-sm font-medium">
          Prompting by <a href="https://xizital.com" target="_blank" rel="noopener noreferrer" className="text-green-600 hover:underline font-bold">Xizital</a>
        </p>
      </footer>

      {/* Floating Coffee Bubble */}
      <div className="fixed bottom-6 right-6 z-50">
        <button 
          onClick={() => setShowCoffeeModal(true)}
          className="w-14 h-14 rounded-full bg-green-600 text-white flex items-center justify-center shadow-2xl hover:scale-110 transition-transform group relative"
        >
          <Coffee size={24} />
          <span className="absolute right-full mr-4 px-3 py-1 bg-neutral-800 text-white text-[10px] rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
            Mời Xizital ly cà phê
          </span>
        </button>
      </div>

      {/* Modals */}
      <AnimatePresence>
        {showApiKeyModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowApiKeyModal(false)}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="relative glass-panel w-full max-w-md p-8 rounded-3xl space-y-6"
            >
              <div className="flex justify-between items-center">
                <h3 className="text-xl font-bold">Quản lý API Key</h3>
                <button onClick={() => setShowApiKeyModal(false)} className="p-2 hover:bg-neutral-100 rounded-full">
                  <X size={20} />
                </button>
              </div>
              <div className="space-y-4">
                <p className="text-sm text-neutral-500">
                  Nhập API Key Gemini của bạn để sử dụng các tính năng AI. Nếu để trống, hệ thống sẽ sử dụng key mặc định.
                </p>
                <input 
                  type="password"
                  placeholder="Nhập API Key tại đây..."
                  value={tempApiKey}
                  onChange={(e) => setTempApiKey(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl bg-neutral-50 border border-neutral-200 focus:border-green-500 outline-none"
                />
                <button 
                  onClick={() => {
                    updateState({ ...state, apiKey: tempApiKey });
                    setShowApiKeyModal(false);
                  }}
                  className="w-full py-3 rounded-xl bg-green-600 text-white font-bold hover:bg-green-700 transition-colors"
                >
                  Lưu thay đổi
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {showCharSelectModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowCharSelectModal(null)}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="relative glass-panel w-full max-w-sm p-8 rounded-3xl space-y-6"
            >
              <div className="flex justify-between items-center">
                <h3 className="text-xl font-bold">Chọn nhân vật</h3>
                <button onClick={() => setShowCharSelectModal(null)} className="p-2 hover:bg-neutral-100 rounded-full">
                  <X size={20} />
                </button>
              </div>
              <div className="space-y-2">
                {state.characters.map(char => (
                  <button
                    key={char.id}
                    onClick={() => {
                      const scene = state.scenes.find(s => s.id === showCharSelectModal.sceneId);
                      if (!scene) return;
                      const newIds = scene.characterIds.includes(char.id)
                        ? scene.characterIds.filter(id => id !== char.id)
                        : [...scene.characterIds, char.id];
                      updateScene(scene.id, { characterIds: newIds });
                    }}
                    className={`w-full p-4 rounded-xl border-2 transition-all flex items-center gap-4 ${
                      state.scenes.find(s => s.id === showCharSelectModal.sceneId)?.characterIds.includes(char.id)
                      ? 'border-green-500 bg-green-50'
                      : 'border-neutral-100 hover:border-neutral-200'
                    }`}
                  >
                    <div className="w-10 h-10 rounded-full bg-neutral-200 overflow-hidden">
                      {char.images[0] && <img src={char.images[0]} className="w-full h-full object-cover" />}
                    </div>
                    <span className="font-bold text-sm">{char.name || "Chưa đặt tên"}</span>
                  </button>
                ))}
              </div>
            </motion.div>
          </div>
        )}

        {fullViewSceneIndex !== null && (
          <div className="fixed inset-0 z-[150] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setFullViewSceneIndex(null)}
              className="absolute inset-0 bg-black/90 backdrop-blur-xl"
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="relative w-full max-w-6xl flex flex-col md:flex-row gap-8 items-start"
            >
              <button 
                onClick={() => setFullViewSceneIndex(null)}
                className="absolute -top-12 right-0 text-white hover:text-green-400 p-2"
              >
                <X size={32} />
              </button>

              <div className="flex-grow relative group">
                <img 
                  src={state.scenes[fullViewSceneIndex].generatedImage!} 
                  className="w-full rounded-2xl shadow-2xl border border-white/10"
                />
                <div className="absolute top-1/2 -translate-y-1/2 left-4">
                  <button 
                    disabled={fullViewSceneIndex === 0}
                    onClick={() => setFullViewSceneIndex(fullViewSceneIndex - 1)}
                    className="p-4 bg-black/50 text-white rounded-full hover:bg-green-600 disabled:opacity-20 transition-all"
                  >
                    <ChevronLeft size={24} />
                  </button>
                </div>
                <div className="absolute top-1/2 -translate-y-1/2 right-4">
                  <button 
                    disabled={fullViewSceneIndex === state.scenes.length - 1}
                    onClick={() => setFullViewSceneIndex(fullViewSceneIndex + 1)}
                    className="p-4 bg-black/50 text-white rounded-full hover:bg-green-600 disabled:opacity-20 transition-all"
                  >
                    <ChevronRight size={24} />
                  </button>
                </div>
              </div>

              <div className="w-full md:w-96 space-y-6 text-white">
                <div className="space-y-2">
                  <h4 className="text-xs font-bold text-green-400 uppercase tracking-widest">Kịch bản phân cảnh {state.scenes[fullViewSceneIndex].sceneCode}</h4>
                  <div className="space-y-4">
                    <div>
                      <h5 className="text-[10px] font-bold text-neutral-500 uppercase">Tiếng Việt</h5>
                      <p className="text-sm leading-relaxed text-neutral-300">
                        {state.scenes[fullViewSceneIndex].vietnamese || "Chưa có nội dung."}
                      </p>
                    </div>
                    <div>
                      <h5 className="text-[10px] font-bold text-neutral-500 uppercase">Tóm tắt Prompt</h5>
                      <p className="text-sm leading-relaxed text-neutral-300 italic">
                        {state.scenes[fullViewSceneIndex].promptName || "Chưa có tóm tắt."}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="space-y-4 pt-6 border-t border-white/10">
                  <div className="space-y-2">
                    <h4 className="text-xs font-bold text-neutral-400 uppercase tracking-widest">Tinh chỉnh Prompt</h4>
                    <textarea 
                      placeholder="Nhập prompt để sửa lại tấm ảnh này..."
                      className="w-full h-32 px-4 py-3 rounded-xl bg-white/5 border border-white/10 focus:border-green-500 outline-none text-sm resize-none"
                      value={state.scenes[fullViewSceneIndex].refinedPrompt || ""}
                      onChange={(e) => updateScene(state.scenes[fullViewSceneIndex].id, { refinedPrompt: e.target.value })}
                    />
                  </div>
                  <button 
                    onClick={() => generateImage(state.scenes[fullViewSceneIndex!].id, state.scenes[fullViewSceneIndex!].refinedPrompt)}
                    disabled={state.scenes[fullViewSceneIndex].isGenerating}
                    className="w-full py-4 rounded-xl bg-green-600 text-white font-bold hover:bg-green-700 transition-colors flex items-center justify-center gap-2"
                  >
                    {state.scenes[fullViewSceneIndex].isGenerating ? <Loader2 size={20} className="animate-spin" /> : <RefreshCw size={20} />}
                    Tạo lại ảnh
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}

        {showCoffeeModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowCoffeeModal(false)}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.9, y: 20, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.9, y: 20, opacity: 0 }}
              className="relative glass-panel w-full max-w-sm p-8 rounded-3xl text-center space-y-6"
            >
              <button onClick={() => setShowCoffeeModal(false)} className="absolute top-4 right-4 p-2 hover:bg-neutral-100 rounded-full">
                <X size={20} />
              </button>
              <div className="space-y-2">
                <h3 className="text-xl font-bold">Mời Xizital một ly cà phê</h3>
                <p className="text-xs text-neutral-500">Nếu bạn thấy những chia sẻ của mình hữu ích</p>
              </div>
              <div className="aspect-square w-full bg-neutral-100 rounded-2xl overflow-hidden border border-neutral-200 p-4">
                <img 
                  src="https://xizital.com/wp-content/uploads/2025/10/z7084477223291_1aa5f551f0f549b6d3d1d72d70e3d4e4.jpg" 
                  alt="QR Coffee"
                  className="w-full h-full object-contain"
                  referrerPolicy="no-referrer"
                />
              </div>
              <p className="text-[10px] text-neutral-400 font-medium italic">
                đổi nội dung bong bóng này tùy theo nhu cầu của bạn
              </p>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
