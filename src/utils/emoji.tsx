import React from 'react';
import emojiMap from '../emoji-map.json';

const escapeRegExp = (string: string) => {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

const emojiKeys = Object.keys(emojiMap);
const sortedEmojiKeys = emojiKeys.sort((a, b) => b.length - a.length);
const emojiRegex = new RegExp(sortedEmojiKeys.map(escapeRegExp).join('|'), 'g');

export const renderTextWithEmojis = (text: string): React.ReactNode => {
  if (!text) return '';

  const parts = text.split(emojiRegex);
  const matches = text.match(emojiRegex) || [];

  const result: React.ReactNode[] = [];
  
  parts.forEach((part, i) => {
    if (part) {
      result.push(part);
    }
    
    if (matches[i]) {
      const unicodeChar = matches[i];
      const filename = (emojiMap as Record<string, string>)[unicodeChar];
      if (filename) {
        result.push(
          <img
            key={`emoji-${i}-${unicodeChar}`}
            src={`/emoji/${filename}.png`}
            className="w-[14px] h-[14px] inline-block align-middle mx-[1px] select-none"
            style={{ 
              imageRendering: 'pixelated',
              width: '14px',
              height: '14px',
              display: 'inline-block',
              verticalAlign: 'middle'
            }}
            alt={unicodeChar}
            title={unicodeChar}
          />
        );
      } else {
        result.push(unicodeChar);
      }
    }
  });

  return <>{result}</>;
};
