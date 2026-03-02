import React from 'react';
import { ChatRoom } from 'amazon-ivs-chat-messaging';

const ChatRoomContext = React.createContext<ChatRoom | undefined>(undefined);

export const useChatRoomContext = () => {
  const context = React.useContext(ChatRoomContext);
  if (context === undefined) {
    throw new Error('useChatRoomContext must be within ChatRoomProvider');
  }
  return context;
};

export const ChatRoomProvider = ChatRoomContext.Provider;
