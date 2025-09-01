import React from 'react';
import { ISPIconProps } from './types.js';

export function NetworkIcon({ className = "", size = 16 }: ISPIconProps) {
  return (
    <svg 
      className={className}
      viewBox="0 0 512 512" 
      xmlns="http://www.w3.org/2000/svg"
      style={{ width: size, height: size }}
    >
      <path 
        d="M256 0C114.615 0 0 114.615 0 256s114.615 256 256 256 256-114.615 256-256S397.385 0 256 0zm0 448c-106.039 0-192-85.961-192-192S149.961 64 256 64s192 85.961 192 192-85.961 192-192 192z"
        fill="currentColor"
      />
    </svg>
  );
}
