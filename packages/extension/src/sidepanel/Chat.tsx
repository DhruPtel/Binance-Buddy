// =============================================================================
// Chat — message list, input, typing indicator, connects to execution agent
// =============================================================================

import { useState, useRef, useEffect } from 'react';
import { MOOD_EMOJI } from '@binancebuddy/buddy';
import type { Mood } from '@binancebuddy/core';

interface Message {
  id: string;
  role: 'user' | 'buddy';
  content: string;
  timestamp: number;
}

interface ChatProps {
  walletAddress: string;
  buddyMood: Mood;
  buddyStage: string;
}

export function Chat({ walletAddress, buddyMood, buddyStage }: ChatProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      role: 'buddy',
      content: `Hey! I'm your Binance Buddy (${buddyStage} stage). Ask me about your portfolio, swap tokens, or just chat about the market.`,
      timestamp: Date.now(),
    },
  ]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [history, setHistory] = useState<unknown[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || isTyping) return;

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setIsTyping(true);

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'CHAT',
        message: text,
        address: walletAddress,
        history,
      }) as { success: boolean; reply?: string; error?: string; updatedHistory?: unknown[] };

      const replyContent = response?.reply ?? response?.error ?? 'Something went wrong.';
      const buddyMsg: Message = {
        id: crypto.randomUUID(),
        role: 'buddy',
        content: replyContent,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, buddyMsg]);
      if (response?.updatedHistory) {
        setHistory(response.updatedHistory);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: 'buddy', content: 'Server not reachable. Is it running?', timestamp: Date.now() },
      ]);
    } finally {
      setIsTyping(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            {msg.role === 'buddy' && (
              <div className="w-7 h-7 rounded-full bg-yellow-500 flex items-center justify-center text-sm flex-shrink-0">
                {MOOD_EMOJI[buddyMood]}
              </div>
            )}
            <div
              className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-blue-600 text-white rounded-tr-sm'
                  : 'bg-gray-700 text-gray-100 rounded-tl-sm'
              }`}
            >
              {msg.content}
            </div>
          </div>
        ))}

        {/* Typing indicator */}
        {isTyping && (
          <div className="flex gap-2 justify-start">
            <div className="w-7 h-7 rounded-full bg-yellow-500 flex items-center justify-center text-sm flex-shrink-0">
              {MOOD_EMOJI[buddyMood]}
            </div>
            <div className="bg-gray-700 rounded-2xl rounded-tl-sm px-3 py-2">
              <div className="flex gap-1 items-center h-4">
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-3 border-t border-gray-700 flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={walletAddress ? 'Ask me anything...' : 'Connect wallet first'}
          disabled={!walletAddress || isTyping}
          className="flex-1 bg-gray-700 text-white text-sm rounded-xl px-3 py-2 outline-none placeholder-gray-500 disabled:opacity-50"
        />
        <button
          onClick={sendMessage}
          disabled={!input.trim() || isTyping || !walletAddress}
          className="bg-yellow-500 hover:bg-yellow-400 disabled:opacity-40 text-gray-900 font-bold rounded-xl px-3 py-2 text-sm transition-colors"
        >
          →
        </button>
      </div>
    </div>
  );
}
