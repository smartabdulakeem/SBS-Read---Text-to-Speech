import React from 'react';
import { Play, Trash2, Clock, FileText } from 'lucide-react';

export default function HistoryList({ history, onSelect, onDelete }) {
  if (history.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-center text-gray-500">
        <FileText className="w-12 h-12 mb-3 opacity-30 text-purple-400" />
        <p className="font-medium text-gray-400">No reading history yet</p>
        <p className="text-xs text-gray-500 mt-1">Uploaded documents or pasted text will appear here.</p>
      </div>
    );
  }

  const formatDate = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getTruncatedTitle = (text, maxLength = 50) => {
    if (!text) return 'Untitled Text';
    const firstLine = text.split('\n')[0].trim();
    if (firstLine.length > maxLength) {
      return firstLine.substring(0, maxLength) + '...';
    }
    return firstLine || 'Untitled Text';
  };

  return (
    <div className="space-y-3 max-h-[350px] overflow-y-auto pr-1">
      {history.map((item) => (
        <div
          key={item.id}
          className="glass-card p-4 flex items-center justify-between gap-4 group hover:border-purple-500/20"
        >
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <button
              onClick={() => onSelect(item)}
              className="w-10 h-10 rounded-full bg-purple-500/10 hover:bg-purple-500/20 text-purple-400 flex items-center justify-center transition-colors flex-shrink-0"
              title="Play this item"
            >
              <Play className="w-4.5 h-4.5 fill-current" />
            </button>
            <div className="min-w-0 flex-1">
              <h4 
                onClick={() => onSelect(item)}
                className="text-sm font-semibold text-gray-200 hover:text-purple-300 transition-colors truncate cursor-pointer"
              >
                {item.title || getTruncatedTitle(item.text)}
              </h4>
              <div className="flex items-center gap-3 text-xs text-gray-500 mt-1">
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {formatDate(item.timestamp)}
                </span>
                <span>•</span>
                <span>{Math.round(item.text.length / 5)} words</span>
              </div>
            </div>
          </div>
          <button
            onClick={() => onDelete(item.id)}
            className="w-8 h-8 rounded-lg hover:bg-red-500/10 text-gray-500 hover:text-red-400 flex items-center justify-center transition-colors flex-shrink-0"
            title="Delete from history"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
