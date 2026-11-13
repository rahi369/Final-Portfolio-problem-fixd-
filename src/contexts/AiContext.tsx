import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useApp } from './AppContext';
import {
  buildPortfolioSnapshot,
  sendAiChatMessage,
  useAiThreads,
} from '../lib/aiAssistant';
import {
  AiChatMessage,
  AiChatMode,
  AiChatPersona,
  AiChatThread,
} from '../types';

interface AiContextValue {
  threads: AiChatThread[];
  activeThread: AiChatThread;
  activeThreadId: string;
  setActiveThreadId: (id: string) => void;
  startNewThread: (persona?: AiChatPersona) => AiChatThread;
  removeThread: (id: string) => void;
  setPersona: (persona: AiChatPersona) => void;
  setMode: (mode: AiChatMode) => void;
  setUseSearch: (useSearch: boolean) => void;
  sendMessage: (text: string) => Promise<void>;
  stopGenerating: () => void;
  sending: boolean;
  streamingText: string;
  error: string | null;
  clearError: () => void;
  drawerOpen: boolean;
  setDrawerOpen: React.Dispatch<React.SetStateAction<boolean>>;
}

const AiContext = createContext<AiContextValue | null>(null);

export function AiProvider({ children }: { children: React.ReactNode }) {
  const {
    isAdmin,
    profile,
    settings,
    projects,
    services,
    skills,
  } = useApp();

  const {
    threads,
    activeThread,
    activeThreadId,
    setActiveThreadId,
    updateActiveThread,
    startNewThread,
    removeThread,
  } = useAiThreads(isAdmin);

  const [sending, setSending] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Ref lock stops duplicate concurrent requests even before React re-renders
  const inFlightRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const portfolioSnapshot = useMemo(
    () =>
      buildPortfolioSnapshot({
        profile,
        settings,
        projects,
        services,
        skills,
      }),
    [profile, settings, projects, services, skills]
  );

  const setPersona = useCallback(
    (persona: AiChatPersona) => {
      if (inFlightRef.current) return;
      updateActiveThread((prev) => ({
        ...prev,
        persona,
        useSearch: persona === 'researcher' ? true : prev.useSearch,
        updatedAt: new Date().toISOString(),
      }));
    },
    [updateActiveThread]
  );

  const setMode = useCallback(
    (mode: AiChatMode) => {
      if (inFlightRef.current) return;
      updateActiveThread((prev) => ({
        ...prev,
        mode,
        updatedAt: new Date().toISOString(),
      }));
    },
    [updateActiveThread]
  );

  const setUseSearch = useCallback(
    (useSearch: boolean) => {
      if (inFlightRef.current) return;
      updateActiveThread((prev) => ({
        ...prev,
        useSearch,
        updatedAt: new Date().toISOString(),
      }));
    },
    [updateActiveThread]
  );

  const stopGenerating = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  const sendMessage = useCallback(
    async (rawText: string) => {
      const text = rawText.trim();
      if (!text || inFlightRef.current || sending) return;

      inFlightRef.current = true;
      const controller = new AbortController();
      abortControllerRef.current = controller;

      setError(null);
      setStreamingText('');

      const userMsg: AiChatMessage = {
        id: `msg_${Date.now()}_u`,
        role: 'user',
        text,
        createdAt: new Date().toISOString(),
      };

      const updatedHistory = [...activeThread.messages, userMsg];
      const nextTitle =
        activeThread.messages.length === 0
          ? text.slice(0, 48) + (text.length > 48 ? '...' : '')
          : activeThread.title;

      updateActiveThread((prev) => ({
        ...prev,
        title: nextTitle,
        messages: [...prev.messages, userMsg],
        updatedAt: new Date().toISOString(),
      }));

      setSending(true);
      try {
        const result = await sendAiChatMessage({
          messages: updatedHistory.slice(-8).map((m) => ({
            role: m.role,
            text: m.text.slice(0, 1500),
          })),
          mode: activeThread.mode,
          persona: activeThread.persona,
          useSearch: activeThread.useSearch,
          portfolioContext: portfolioSnapshot,
          signal: controller.signal,
          onStreamUpdate: ({ text: partialText }) => {
            setStreamingText(partialText);
          },
        });

        const modelMsg: AiChatMessage = {
          id: `msg_${Date.now()}_m`,
          role: 'model',
          text: result.reply,
          createdAt: new Date().toISOString(),
          modelUsed: result.modelUsed,
          grounded: result.grounded,
          searchQueries: result.searchQueries,
          sources: result.sources,
        };

        updateActiveThread(
          (prev) => ({
            ...prev,
            title: nextTitle,
            messages: [...prev.messages, modelMsg],
            updatedAt: new Date().toISOString(),
          }),
          true
        );
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : 'Unable to reach Rahi’s Official AI Assistant right now.';
        setError(message);
      } finally {
        inFlightRef.current = false;
        abortControllerRef.current = null;
        setStreamingText('');
        setSending(false);
      }
    },
    [activeThread, portfolioSnapshot, sending, updateActiveThread]
  );

  const value = useMemo<AiContextValue>(
    () => ({
      threads,
      activeThread,
      activeThreadId,
      setActiveThreadId,
      startNewThread,
      removeThread,
      setPersona,
      setMode,
      setUseSearch,
      sendMessage,
      stopGenerating,
      sending,
      streamingText,
      error,
      clearError: () => setError(null),
      drawerOpen,
      setDrawerOpen,
    }),
    [
      threads,
      activeThread,
      activeThreadId,
      setActiveThreadId,
      startNewThread,
      removeThread,
      setPersona,
      setMode,
      setUseSearch,
      sendMessage,
      stopGenerating,
      sending,
      streamingText,
      error,
      drawerOpen,
    ]
  );

  return <AiContext.Provider value={value}>{children}</AiContext.Provider>;
}

export function useAi() {
  const ctx = useContext(AiContext);
  if (!ctx) throw new Error('useAi must be used inside AiProvider');
  return ctx;
}
