import React from 'react';

interface MessageInputProps {
  onSendMessage: (content: string) => void;
  disabled: boolean;
}

export const MessageInput: React.FC<MessageInputProps> = ({ onSendMessage, disabled }) => {
  const [content, setContent] = React.useState('');
  const inputRef = React.useRef<HTMLInputElement>(null);
  const maxLength = 500;

  const handleSend = () => {
    if (content.trim() && !disabled) {
      onSendMessage(content.trim());
      setContent('');
      // Re-focus input after sending
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const canSend = !disabled && content.trim().length > 0;

  return (
    <div className="border-t border-gray-200 bg-white/80 backdrop-blur-sm px-3 py-2.5">
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          type="text"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={handleKeyDown}
          maxLength={maxLength}
          disabled={disabled}
          placeholder={disabled ? 'Connecting...' : 'Type a message...'}
          className="flex-1 px-3 py-2 bg-gray-100 border border-transparent rounded-full text-sm placeholder-gray-400 transition-all duration-200 focus:outline-none focus:bg-white focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:bg-gray-50 disabled:text-gray-400"
        />
        <button
          onClick={handleSend}
          disabled={!canSend}
          className={`flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-full text-white transition-all duration-200 ${
            canSend
              ? 'bg-blue-600 hover:bg-blue-700 active:scale-95 shadow-sm'
              : 'bg-gray-300 cursor-not-allowed'
          }`}
          aria-label="Send message"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="w-4 h-4"
          >
            <path d="M3.105 2.288a.75.75 0 0 0-.826.95l1.414 4.926A1.5 1.5 0 0 0 5.135 9.25h6.115a.75.75 0 0 1 0 1.5H5.135a1.5 1.5 0 0 0-1.442 1.086L2.28 16.762a.75.75 0 0 0 .826.95l15.19-5.44a.75.75 0 0 0 0-1.415L3.105 2.288Z" />
          </svg>
        </button>
      </div>
      {content.length > 400 && (
        <p className="text-[10px] text-gray-400 mt-1 text-right pr-12">
          {content.length}/{maxLength}
        </p>
      )}
    </div>
  );
};
